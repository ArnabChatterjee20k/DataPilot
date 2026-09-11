import { expect, test, type Page } from "./fixtures";

import {
  API_URL,
  createSqliteConnection,
  deleteAllConnections,
  openPlayground,
  type SeededConnection,
} from "./helpers";
import { startUpstream, UPSTREAM_URL, type Upstream } from "./upstream";

let upstream: Upstream;

test.beforeAll(async () => {
  upstream = await startUpstream();
});

test.afterAll(async () => {
  await upstream.stop();
});

let database: SeededConnection;

test.beforeEach(async ({ request }) => {
  await deleteAllConnections(request);
  // flows live outside connections, so they survive deleteAllConnections
  const flows = await (await request.get(`${API_URL}/flows`)).json();
  for (const flow of flows.flows ?? []) {
    await request.delete(`${API_URL}/flows/${flow.uid}`);
  }

  database = await createSqliteConnection(request, { name: "Shop" });
  await request.post(`${API_URL}/connections`, {
    data: { source: "api", name: "Echo API", connection_uri: UPSTREAM_URL },
  });
});

const node = (page: Page, name: string) =>
  page.locator(`[data-testid="flow-node-${name}"]`);

async function newFlow(page: Page) {
  await openPlayground(page);
  await page.getByRole("button", { name: "New flow" }).click();
  await expect(page.getByTestId("flow-canvas")).toBeVisible();
}

async function addQueryNode(page: Page, name: string, query: string) {
  await page.getByRole("button", { name: "Query node" }).click();
  await page.getByLabel("Node name").fill(name);
  await page.getByLabel("Node connection").click();
  await page.getByRole("option", { name: database.name }).click();
  await page.getByLabel("Node query").fill(query);
}

async function addRequestNode(page: Page, name: string, path: string, body?: string) {
  await page.getByRole("button", { name: "Request node" }).click();
  await page.getByLabel("Node name").fill(name);
  await page.getByLabel("Node connection").click();
  await page.getByRole("option", { name: "Echo API" }).click();
  await page.getByLabel("Node path").fill(path);
  if (body) {
    await page.getByLabel("Node method").click();
    await page.getByRole("option", { name: "POST" }).click();
    await page.getByLabel("Node body").fill(body);
  }
}

/** Join two nodes by dragging from one handle to the other, as a person would. */
async function connect(page: Page, from: string, to: string) {
  const source = node(page, from).locator(".react-flow__handle-right");
  const target = node(page, to).locator(".react-flow__handle-left");
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe("the flow canvas", () => {
  test("an empty flow says what to do", async ({ page }) => {
    await newFlow(page);
    await expect(page.getByText("Nothing on the canvas yet")).toBeVisible();
    await expect(page.getByRole("button", { name: /Run/ })).toBeDisabled();
  });

  test("a node appears on the canvas with its state", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Users", "SELECT id FROM users");

    await expect(node(page, "Users")).toBeVisible();
    await expect(node(page, "Users")).toHaveAttribute("data-state", "idle");
    await expect(node(page, "Users")).toContainText("SELECT id FROM users");
    await expect(node(page, "Users")).toContainText(database.name);
  });

  test("a node without a connection says so on the card", async ({ page }) => {
    await newFlow(page);
    await page.getByRole("button", { name: "Query node" }).click();
    await page.getByLabel("Node name").fill("Nowhere");

    await expect(node(page, "Nowhere")).toContainText("no connection chosen");
  });

  test("a query node is not offered API connections", async ({ page }) => {
    await newFlow(page);
    await page.getByRole("button", { name: "Query node" }).click();
    await page.getByLabel("Node connection").click();

    await expect(page.getByRole("option", { name: database.name })).toBeVisible();
    await expect(page.getByRole("option", { name: "Echo API" })).toHaveCount(0);
  });

  test("a request node is not offered database connections", async ({ page }) => {
    await newFlow(page);
    await page.getByRole("button", { name: "Request node" }).click();
    await page.getByLabel("Node connection").click();

    await expect(page.getByRole("option", { name: "Echo API" })).toBeVisible();
    await expect(page.getByRole("option", { name: database.name })).toHaveCount(0);
  });
});

test.describe("running a flow", () => {
  test("a row from the database reaches the API", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Users", "SELECT id, name FROM users ORDER BY id");
    await addRequestNode(
      page,
      "Notify",
      "/echo",
      '{"id": {{Users.first.id}}, "name": "{{Users.first.name}}"}'
    );
    await page.getByLabel("Close the inspector").click();
    await connect(page, "Users", "Notify");

    await page.getByRole("button", { name: /Run/ }).click();

    await expect(node(page, "Users")).toHaveAttribute("data-state", "succeeded", {
      timeout: 20_000,
    });
    await expect(node(page, "Users")).toContainText("6 rows");
    await expect(node(page, "Notify")).toHaveAttribute("data-state", "succeeded");
    await expect(node(page, "Notify")).toContainText("200 OK");
    await expect(page.getByRole("status")).toContainText("2 succeeded");

    // and the row really travelled: the echo carries what the query found
    await node(page, "Notify").click();
    await page.getByRole("tab", { name: "result" }).click();
    const result = page.getByLabel("Node result");
    await expect(result).toContainText("Alice Johnson");
  });

  test("a node shows what it produced", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Users", "SELECT id, name FROM users ORDER BY id");
    await page.getByRole("button", { name: /Run/ }).click();
    await expect(node(page, "Users")).toHaveAttribute("data-state", "succeeded", {
      timeout: 20_000,
    });

    await page.getByRole("tab", { name: "result" }).click();
    await expect(page.getByLabel("Node result")).toContainText("Alice Johnson");
  });

  test("a failure does not blame the nodes after it", async ({ page, request }) => {
    await request.post(`${API_URL}/connections`, {
      data: { source: "api", name: "Nowhere", connection_uri: "http://127.0.0.1:1" },
    });

    await newFlow(page);
    await page.getByRole("button", { name: "Request node" }).click();
    await page.getByLabel("Node name").fill("Broken");
    await page.getByLabel("Node connection").click();
    await page.getByRole("option", { name: "Nowhere" }).click();
    await page.getByLabel("Node path").fill("/ping");

    await addRequestNode(page, "After", "/ping");
    await page.getByLabel("Close the inspector").click();
    await connect(page, "Broken", "After");

    await page.getByRole("button", { name: /Run/ }).click();

    await expect(node(page, "Broken")).toHaveAttribute("data-state", "failed", {
      timeout: 25_000,
    });
    // never ran is not the same as failed
    await expect(node(page, "After")).toHaveAttribute("data-state", "skipped");
    await expect(node(page, "After")).toContainText("waiting on Broken");

    await node(page, "After").click();
    await page.getByRole("tab", { name: "result" }).click();
    await expect(page.getByText("This node never ran")).toBeVisible();
  });

  test("a reference to nothing is flagged on the node that used it", async ({
    page,
  }) => {
    await newFlow(page);
    await addRequestNode(page, "Dangling", "/echo?who={{ghost.id}}");
    await page.getByLabel("Close the inspector").click();

    await page.getByRole("button", { name: /Run/ }).click();
    await expect(node(page, "Dangling")).toHaveAttribute("data-state", "succeeded", {
      timeout: 20_000,
    });
    await expect(node(page, "Dangling")).toContainText("no node called 'ghost'");
  });

  test("the flow survives a reload", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Users", "SELECT id FROM users");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("unsaved")).toHaveCount(0);

    await page.reload();
    await expect(node(page, "Users")).toBeVisible();
    await expect(node(page, "Users")).toContainText("SELECT id FROM users");
  });
});

test.describe("flows in the sidebar", () => {
  test("a flow is created, listed and deleted", async ({ page }) => {
    await openPlayground(page);
    await expect(page.getByText("A flow wires a query into a request.")).toBeVisible();

    await page.getByRole("button", { name: "New flow" }).click();
    await expect(page.getByRole("button", { name: "Flow 1", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Delete Flow 1" }).click();
    await expect(page.getByRole("button", { name: "Flow 1", exact: true })).toHaveCount(0);
  });
});
