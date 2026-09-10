import { expect, test } from "./fixtures";

import { API_URL, deleteAllConnections, openPlayground } from "./helpers";
import { startUpstream, UPSTREAM_URL, type Upstream } from "./upstream";

const requestTab = (page: import("@playwright/test").Page, name: string | RegExp) =>
  page.getByRole("tablist", { name: "Request sections" }).getByRole("tab", { name });

const responseTab = (page: import("@playwright/test").Page, name: string | RegExp) =>
  page.getByRole("tablist", { name: "Response sections" }).getByRole("tab", { name });

let upstream: Upstream;

test.beforeAll(async () => {
  upstream = await startUpstream();
});

test.afterAll(async () => {
  await upstream.stop();
});

let connectionName: string;

test.beforeEach(async ({ request }) => {
  await deleteAllConnections(request);
  connectionName = `Upstream ${Date.now()}`;

  const created = await request.post(`${API_URL}/connections`, {
    data: {
      source: "api",
      name: connectionName,
      connection_uri: UPSTREAM_URL,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
});

async function openApiConnection(page: import("@playwright/test").Page) {
  await openPlayground(page);
  await page.getByRole("button", { name: connectionName, exact: true }).click();
}

test.describe("sending a request", () => {
  test("sends a GET and shows the response", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();

    await page.getByLabel("Request path").fill("/ping");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("200");
    await expect(page.getByLabel("Response body", { exact: true })).toContainText('"pong": true');
  });

  test("a non-2xx status is shown as a response, not an error", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();

    await page.getByLabel("Request path").fill("/teapot");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(page.getByRole("status")).toContainText("418");
    await expect(page.getByLabel("Response body", { exact: true })).toContainText("I am a teapot");
    await expect(page.getByText("Request failed")).toHaveCount(0);
  });

  test("query parameters and headers are sent", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();
    await page.getByLabel("Request path").fill("/echo");

    await page.getByLabel("Query parameter key 1").fill("page");
    await page.getByLabel("Query parameter value 1").fill("2");

    await requestTab(page, /Headers/).click();
    await page.getByLabel("Header key 1").fill("X-Trace");
    await page.getByLabel("Header value 1").fill("abc123");

    await page.getByRole("button", { name: "Send", exact: true }).click();

    const body = page.getByLabel("Response body", { exact: true });
    await expect(body).toContainText('"page": "2"');
    await expect(body).toContainText("abc123");
  });

  test("a disabled row is not sent", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();
    await page.getByLabel("Request path").fill("/echo");

    await page.getByLabel("Query parameter key 1").fill("keep");
    await page.getByLabel("Query parameter value 1").fill("yes");
    await page.getByLabel("Query parameter key 2").fill("drop");
    await page.getByLabel("Query parameter value 2").fill("no");
    await page.getByRole("checkbox", { name: "Enable drop" }).click();

    await page.getByRole("button", { name: "Send", exact: true }).click();

    const body = page.getByLabel("Response body", { exact: true });
    await expect(body).toContainText('"keep": "yes"');
    await expect(body).not.toContainText('"drop"');
  });

  test("a POST sends its JSON body", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();
    await page.getByLabel("Request path").fill("/echo");

    await page.getByLabel("Method").click();
    await page.getByRole("option", { name: "POST" }).click();

    await requestTab(page, /Body/).click();
    await page.getByRole("button", { name: "JSON" }).click();
    await page.getByLabel("Request body", { exact: true }).fill('{"name": "Ada"}');

    await page.getByRole("button", { name: "Send", exact: true }).click();

    const body = page.getByLabel("Response body", { exact: true });
    await expect(body).toContainText('"method": "POST"');
    await expect(body).toContainText("Ada");
  });

  test("invalid JSON is flagged before sending", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();

    await requestTab(page, /Body/).click();
    await page.getByRole("button", { name: "JSON" }).click();
    await page.getByLabel("Request body", { exact: true }).fill("{not json");

    await expect(page.getByText(/Not valid JSON/)).toBeVisible();
  });

  test("credentials are masked in the request preview", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();
    await page.getByLabel("Request path").fill("/echo");

    await requestTab(page, /Auth/).click();
    await page.getByLabel("Auth type").click();
    await page.getByRole("option", { name: "Bearer token" }).click();
    await page.getByLabel("Token").fill("supersecrettoken");

    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("200");

    await responseTab(page, "Request").click();
    await expect(page.getByText(/credential values are masked/)).toBeVisible();
    const preview = page.getByRole("tabpanel", { name: "Request" });
    await expect(preview).toContainText("Sent");
    await expect(preview).not.toContainText("supersecrettoken");

    // ...but the real token reached the upstream service
    await responseTab(page, "Body").click();
    await expect(page.getByLabel("Response body", { exact: true })).toContainText("supersecrettoken");
  });

  test("an unreachable host reports the failure", async ({ page, request, pageErrors: _errors }) => {
    const created = await request.post(`${API_URL}/connections`, {
      data: {
        source: "api",
        name: "Nowhere",
        connection_uri: "http://127.0.0.1:1",
      },
    });
    expect(created.ok()).toBeTruthy();

    await openPlayground(page);
    await page.getByRole("button", { name: "Nowhere", exact: true }).click();
    await page.getByRole("button", { name: "New request" }).click();
    await page.getByLabel("Request path").fill("/ping");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(page.getByText("Request failed")).toBeVisible();
  });
});

test.describe("saved requests", () => {
  test("saves a request and reopens it from the sidebar", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();

    await page.getByLabel("Request name").fill("Ping check");
    await page.getByLabel("Request path").fill("/ping");
    await page.getByRole("button", { name: /Save/ }).click();

    await expect(page.getByRole("button", { name: "Ping check", exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: connectionName, exact: true }).click();
    await page.getByRole("button", { name: "Ping check", exact: true }).click();

    await expect(page.getByLabel("Request path")).toHaveValue("/ping");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("200");
  });

  test("saving twice updates rather than duplicating", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();

    await page.getByLabel("Request name").fill("Once");
    await page.getByLabel("Request path").fill("/ping");
    await page.getByRole("button", { name: /Save/ }).click();
    await expect(page.getByRole("button", { name: "Once", exact: true })).toBeVisible();

    await page.getByLabel("Request name").fill("Renamed");
    await page.getByRole("button", { name: /Save/ }).click();

    await expect(page.getByRole("button", { name: "Renamed", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Once", exact: true })).toHaveCount(0);
  });

  test("deletes a saved request", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();
    await page.getByLabel("Request name").fill("Temporary");
    await page.getByLabel("Request path").fill("/ping");
    await page.getByRole("button", { name: /Save/ }).click();

    const entry = page.getByRole("button", { name: "Temporary", exact: true });
    await expect(entry).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await entry.hover();
    await page.getByRole("button", { name: "Delete request Temporary" }).click();

    await expect(page.getByRole("button", { name: "Temporary", exact: true })).toHaveCount(0);
  });
});

test.describe("websocket console", () => {
  test("connects, exchanges frames and disconnects", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "WebSocket" }).click();

    await expect(page.getByLabel("Socket state")).toContainText("closed");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByLabel("Socket state")).toContainText("open");

    const log = page.getByRole("list", { name: "Socket messages" });
    await expect(log.locator('[data-direction="received"]')).toContainText("welcome");

    await page.getByLabel("Message to send").fill("hello");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(log.locator('[data-direction="sent"]')).toContainText("hello");
    await expect(
      log.locator('[data-direction="received"]').filter({ hasText: "echo:hello" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByLabel("Socket state")).toContainText("closed");
  });

  test("clears the log", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "WebSocket" }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByLabel("Socket state")).toContainText("open");

    await page.getByRole("button", { name: "Clear log" }).click();
    await expect(page.getByRole("list", { name: "Socket messages" })).toHaveCount(0);
  });

  test("a socket that cannot connect says so, prominently", async ({
    page,
    request,
    pageErrors: _errors,
  }) => {
    const created = await request.post(`${API_URL}/connections`, {
      data: {
        source: "api",
        name: "Dead socket",
        connection_uri: "http://127.0.0.1:1",
      },
    });
    expect(created.ok()).toBeTruthy();

    await openPlayground(page);
    await page.getByRole("button", { name: "Dead socket", exact: true }).click();
    await page.getByRole("button", { name: "WebSocket" }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();

    await expect(page.getByText("Could not connect")).toBeVisible();
    await expect(page.getByLabel("Socket state")).toContainText("closed");
    // and it is recoverable - Connect is offered again
    await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
  });

  test("a failed connect clears once it succeeds", async ({
    page,
    pageErrors: _errors,
  }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "WebSocket" }).click();

    await page.getByLabel("Socket path").fill("/stream");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByLabel("Socket state")).toContainText("open");

    await expect(page.getByText("Could not connect")).toHaveCount(0);
  });

  test("cannot send while disconnected", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "WebSocket" }).click();

    await expect(page.getByLabel("Message to send")).toBeDisabled();
  });
});

test.describe("connection kinds stay distinct", () => {
  test("an API connection offers requests, not tables", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);

    await expect(page.getByRole("button", { name: "New request" })).toBeVisible();
    await expect(page.getByRole("button", { name: "WebSocket" })).toBeVisible();
    await expect(page.getByText("No tables")).toHaveCount(0);
  });
});

/** A real paste event, so the component's own handler is what runs. */
async function paste(page: import("@playwright/test").Page, label: string, text: string) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.getByLabel(label).focus();
  await page.keyboard.press("ControlOrMeta+V");
}

test.describe("pasting a curl command", () => {
  test("fills the whole request out of the paste", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();

    await paste(
      page,
      "Request path",
      `curl '${UPSTREAM_URL}/echo?page=2' -X POST ` +
        `-H 'X-Trace: abc123' -H 'Authorization: Bearer tok_1' ` +
        `-H 'Content-Type: application/json' --data-raw '{"name":"Ada"}'`
    );

    await expect(page.getByText(/Parsed curl/)).toBeVisible();
    await expect(page.getByLabel("Request path")).toHaveValue("/echo");
    await expect(page.getByLabel("Method")).toContainText("POST");
    await expect(page.getByLabel("Query parameter key 1")).toHaveValue("page");

    await page.getByRole("button", { name: "Send", exact: true }).click();

    const body = page.getByLabel("Response body", { exact: true });
    await expect(body).toContainText('"method": "POST"');
    await expect(body).toContainText("abc123");
    await expect(body).toContainText("Bearer tok_1");
    await expect(body).toContainText("Ada");
  });

  test("a plain URL is pasted as a URL", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();

    await paste(page, "Request path", "/ping");

    await expect(page.getByLabel("Request path")).toHaveValue("/ping");
    await expect(page.getByText(/Parsed curl/)).toHaveCount(0);
  });
});

test.describe("where the request goes", () => {
  test("the resolved URL is shown as the path is typed", async ({ page, pageErrors: _errors }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();

    await page.getByLabel("Request path").fill("/ping");
    await expect(page.getByTestId("request-target")).toHaveText(`${UPSTREAM_URL}/ping`);
  });

  test("an absolute URL says the base is not used, and is the URL that is called", async ({
    page,
    pageErrors: _errors,
  }) => {
    await openApiConnection(page);
    await page.getByRole("button", { name: "New request" }).click();

    await page.getByLabel("Request path").fill(`${UPSTREAM_URL}/teapot`);
    await expect(page.getByTestId("request-target")).toContainText(
      "the connection's base is not used"
    );

    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("418");
  });

  test("a request with no connection sends to an absolute URL", async ({
    page,
    pageErrors: _errors,
  }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "Request any URL" }).click();

    const send = page.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeDisabled();
    await expect(page.getByTestId("request-target")).toContainText("No connection");

    await page.getByLabel("Request path").fill(`${UPSTREAM_URL}/ping`);
    await expect(send).toBeEnabled();
    await send.click();

    await expect(page.getByRole("status")).toContainText("200");
    await expect(page.getByLabel("Response body", { exact: true })).toContainText('"pong": true');
  });

  test("a request with no connection cannot be saved, and says so", async ({
    page,
    pageErrors: _errors,
  }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "Request any URL" }).click();

    const save = page.getByRole("button", { name: /Save/ });
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute("title", /Pick a connection/);
  });

  test("picking a connection in the builder gives the request its base", async ({
    page,
    pageErrors: _errors,
  }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "Request any URL" }).click();

    await page.getByRole("combobox", { name: "Connection" }).click();
    await page.getByRole("option", { name: connectionName }).click();

    await page.getByLabel("Request path").fill("/ping");
    await expect(page.getByTestId("request-target")).toHaveText(`${UPSTREAM_URL}/ping`);
  });
});
