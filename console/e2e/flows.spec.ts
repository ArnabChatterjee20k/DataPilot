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

test.describe("keyboard shortcuts", () => {
  test("Q and R drop a node on the canvas", async ({ page }) => {
    await newFlow(page);
    await page.getByTestId("flow-canvas").click();

    await page.keyboard.press("q");
    await expect(node(page, "Query 1")).toBeVisible();

    await page.keyboard.press("r");
    await expect(node(page, "Request 1")).toBeVisible();
  });

  test("a letter typed into a field stays in the field", async ({ page }) => {
    await newFlow(page);
    await page.getByRole("button", { name: "Query node" }).click();

    const name = page.getByLabel("Node name");
    await name.fill("");
    await name.type("query for quotes");

    await expect(name).toHaveValue("query for quotes");
    // one node, not one per q and r typed
    await expect(page.locator('[data-testid^="flow-node-"]')).toHaveCount(1);
  });

  test("Delete removes the selected node and the edges into it", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select 1 as id");
    await addRequestNode(page, "Send", "/echo");
    await connect(page, "Rows", "Send");

    await node(page, "Send").click();
    await page.keyboard.press("Delete");

    await expect(node(page, "Send")).toHaveCount(0);
    await expect(node(page, "Rows")).toBeVisible();
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  });

  test("a deletion is offered for saving rather than lost quietly", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select 1 as id");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

    await node(page, "Rows").click();
    await page.keyboard.press("Delete");

    await expect(page.getByText("unsaved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("duplicating copies the node rather than the reference to it", async ({
    page,
  }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select 1 as id");

    await node(page, "Rows").click();
    await page.keyboard.press("ControlOrMeta+d");

    await expect(node(page, "Rows copy")).toBeVisible();
    await page.getByLabel("Node name").fill("Renamed");
    await expect(node(page, "Rows")).toBeVisible();
  });

  test("the shortcut list is there to be read, and Escape closes it", async ({
    page,
  }) => {
    await newFlow(page);
    await page.getByTestId("flow-canvas").click();

    await page.keyboard.press("?");
    const list = page.getByRole("list", { name: "Keyboard shortcuts" });
    await expect(list).toBeVisible();
    await expect(list).toContainText("Add a query node");
    await expect(list).toContainText("Duplicate the selection");

    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
  });

  test("Ctrl+S saves without reaching for the button", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select 1 as id");
    await expect(page.getByText("unsaved")).toBeVisible();

    // from inside the query field, because that is where the caret will be
    await page.getByLabel("Node query").press("ControlOrMeta+s");

    await expect(page.getByText("unsaved")).toHaveCount(0);
  });

  test("arrows nudge the selected node", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select 1 as id");

    const card = node(page, "Rows");
    await card.click();
    const before = (await card.boundingBox())!;

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");

    const after = (await card.boundingBox())!;
    expect(after.x).toBeGreaterThan(before.x);
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  });
});

test.describe("testing one node", () => {
  test("a query node reports what it produced, without running the flow", async ({
    page,
  }) => {
    await newFlow(page);
    await addQueryNode(page, "Parts", "select id, name from users limit 2");

    await page.getByRole("button", { name: "Test this node" }).click();

    await expect(page.getByLabel("What was sent")).toContainText(
      "select id, name from users limit 2"
    );
    await expect(page.getByLabel("What came back")).toContainText("Alice Johnson");
  });

  test("a request node shows the reference replaced by its value", async ({
    page,
  }) => {
    await newFlow(page);
    await addQueryNode(page, "Parts", "select id, name from users limit 2");
    await addRequestNode(page, "Send", "/echo", '{"id": {{Parts.first.id}}}');
    await connect(page, "Parts", "Send");

    await node(page, "Send").click();
    await page.getByRole("button", { name: "Test this node" }).click();

    // the reference is gone and the value is in its place
    await expect(page.getByLabel("What was sent")).toContainText('{"id": 1}');
    await expect(page.getByLabel("What was sent")).not.toContainText("{{Parts");
  });

  test("a tested node shows how the next one refers to what it produced", async ({
    page,
  }) => {
    await newFlow(page);
    await addQueryNode(page, "Parts", "select id, name from users limit 2");

    await page.getByRole("button", { name: "Test this node" }).click();

    const table = page.getByRole("table", { name: "How the next node uses this" });
    await expect(table).toBeVisible();
    await expect(table).toContainText("You write");
    await expect(table).toContainText("You get");

    // the reference and the value it holds, side by side, ready to copy
    const row = (reference: string) =>
      table.locator("tr").filter({ hasText: reference });
    await expect(row("{{Parts.first.id}}")).toContainText("1");
    await expect(row("{{Parts.first.name}}")).toContainText("Alice Johnson");
    await expect(row("{{Parts.row_count}}")).toContainText("2");
    await expect(table).toContainText("{{Parts.columns.0}}");
    // indexing is shown on a row that exists
    await expect(table).toContainText("{{Parts.rows.1.id}}");
  });

  test("a reference copies to the clipboard as written", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await newFlow(page);
    await addQueryNode(page, "Get parts", "select id from users limit 1");

    await page.getByRole("button", { name: "Test this node" }).click();
    await page
      .getByRole("button", { name: "Copy {{Get_parts.first.id}}" })
      .click();

    // the underscore form is the one that resolves, so it is the one copied
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe("{{Get_parts.first.id}}");
  });

  test("what the node can refer to is listed with the values it holds", async ({
    page,
  }) => {
    await newFlow(page);
    await addQueryNode(page, "Parts", "select id, name from users limit 2");
    await addRequestNode(page, "Send", "/echo");
    await connect(page, "Parts", "Send");

    await node(page, "Send").click();
    await page.getByRole("button", { name: "Test this node" }).click();

    const offered = page.getByRole("table", { name: "From Parts" });
    await expect(offered).toBeVisible();
    await expect(offered).toContainText("{{Parts.first.id}}");
    await expect(offered).toContainText("{{Parts.row_count}}");
    // the value beside it is the point: it says what will actually be sent
    await expect(offered.locator("tr").filter({ hasText: "first.name" })).toContainText(
      "Alice Johnson"
    );
  });

  test("a name with a space is offered in the form that actually resolves", async ({
    page,
  }) => {
    await newFlow(page);
    await addQueryNode(page, "Get parts", "select id from users limit 1");
    await addRequestNode(page, "Send", "/echo");
    await connect(page, "Get parts", "Send");

    await node(page, "Send").click();
    await page.getByRole("button", { name: "Test this node" }).click();

    const offered = page.getByRole("table", { name: "From Get parts" });
    await expect(offered).toContainText("{{Get_parts.first.id}}");
    await expect(offered).not.toContainText("{{Get parts.");
  });

  test("a node waiting on a broken one says it never ran", async ({ page }) => {
    await newFlow(page);
    // a query node with no connection cannot run at all
    await page.getByRole("button", { name: "Query node" }).click();
    await page.getByLabel("Node name").fill("Broken");
    await page.getByLabel("Node query").fill("select 1");
    await addRequestNode(page, "Send", "/echo");
    await connect(page, "Broken", "Send");

    await node(page, "Send").click();
    await page.getByRole("button", { name: "Test this node" }).click();

    await expect(page.getByText(/This node never ran/)).toBeVisible();
    await expect(page.getByText(/waiting on Broken/)).toBeVisible();
  });

  test("an unsaved edit is saved before it is tested", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Parts", "select id from users limit 1");
    await expect(page.getByText("unsaved")).toBeVisible();

    await page.getByRole("button", { name: "Test this node" }).click();

    // otherwise the server would test the graph as it was before the edit
    await expect(page.getByLabel("What came back")).toBeVisible();
    await expect(page.getByText("unsaved")).toHaveCount(0);
  });

  test("the result belongs to the node that is open", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Parts", "select id from users limit 1");
    await page.getByRole("button", { name: "Test this node" }).click();
    await expect(page.getByLabel("What came back")).toBeVisible();

    await addRequestNode(page, "Send", "/echo");

    // a result left over from another node is worse than no result
    await expect(page.getByLabel("What came back")).toHaveCount(0);
  });
});
