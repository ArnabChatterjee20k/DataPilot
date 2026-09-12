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

test.describe("selecting more than one node", () => {
  async function threeNodes(page: Page) {
    await newFlow(page);
    await page.getByTestId("flow-canvas").click();
    await page.keyboard.press("q");
    await page.keyboard.press("q");
    await page.keyboard.press("r");
  }

  const panel = (page: Page) =>
    page.getByRole("complementary", { name: "Selection" });

  test("dragging across the canvas rubber-bands a selection", async ({ page }) => {
    await threeNodes(page);
    // the inspector is open on the node that was just added
    await expect(page.getByRole("complementary", { name: /settings/ })).toBeVisible();

    const canvas = (await page.getByTestId("flow-canvas").boundingBox())!;
    await page.mouse.move(canvas.x + 20, canvas.y + 20);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width - 40, canvas.y + 400, { steps: 12 });
    await page.mouse.up();

    await expect(panel(page)).toContainText("3 nodes selected");
    // and the single-node inspector steps aside rather than showing one of them
    await expect(page.getByRole("complementary", { name: /settings/ })).toHaveCount(0);
  });

  test("select all picks up every node", async ({ page }) => {
    await threeNodes(page);
    await page.getByTestId("flow-canvas").click();
    await page.keyboard.press("ControlOrMeta+a");

    await expect(panel(page)).toContainText("3 nodes selected");
    await expect(panel(page).getByRole("list", { name: "Selected nodes" })).toContainText(
      "Query 1"
    );
  });

  test("laying them out in a column leaves none hidden behind another", async ({
    page,
  }) => {
    await threeNodes(page);
    await page.getByTestId("flow-canvas").click();
    await page.keyboard.press("ControlOrMeta+a");
    await panel(page).getByRole("button", { name: "Column" }).click();

    const boxes = await Promise.all(
      ["Query 1", "Query 2", "Request 1"].map((name) => node(page, name).boundingBox())
    );
    const xs = boxes.map((box) => Math.round(box!.x));
    const ys = boxes.map((box) => Math.round(box!.y));

    // one column: the same left edge, and no two at the same height
    expect(new Set(xs).size).toBe(1);
    expect(new Set(ys).size).toBe(3);
  });

  test("deleting the selection takes all of them", async ({ page }) => {
    await threeNodes(page);
    await page.getByTestId("flow-canvas").click();
    await page.keyboard.press("ControlOrMeta+a");
    await panel(page).getByRole("button", { name: "Delete" }).click();

    await expect(page.locator('[data-testid^="flow-node-"]')).toHaveCount(0);
    await expect(page.getByText("Nothing on the canvas yet")).toBeVisible();
  });

  test("Escape clears it and the canvas keeps the nodes", async ({ page }) => {
    await threeNodes(page);
    await page.getByTestId("flow-canvas").click();
    await page.keyboard.press("ControlOrMeta+a");
    await expect(panel(page)).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('[data-testid^="flow-node-"]')).toHaveCount(3);
  });

  test("one node still opens its own settings", async ({ page }) => {
    await threeNodes(page);
    await node(page, "Query 1").click();

    await expect(page.getByRole("complementary", { name: "Query 1 settings" })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });
});

test.describe("the inspector is adjustable", () => {
  test("dragging the handle makes it wider, and the width is remembered", async ({
    page,
  }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select 1 as id");

    const inspector = page.getByRole("complementary", { name: "Rows settings" });
    const before = (await inspector.boundingBox())!;

    const handle = page.locator('[role="separator"]').last();
    const grip = (await handle.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x - 160, grip.y + grip.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = (await inspector.boundingBox())!;
    expect(after.width).toBeGreaterThan(before.width + 80);

    // it is a preference, so it survives a reload
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("unsaved")).toHaveCount(0);
    await page.reload();
    await node(page, "Rows").click();
    const reopened = (await page
      .getByRole("complementary", { name: "Rows settings" })
      .boundingBox())!;
    expect(Math.abs(reopened.width - after.width)).toBeLessThan(30);
  });
});

test.describe("a constants node", () => {
  async function addConstants(page: Page, name: string, values: [string, string][]) {
    await page.getByRole("button", { name: "Constants" }).click();
    await page.getByLabel("Node name").fill(name);
    const rows = page.getByLabel("Constant values");
    for (const [index, [key, value]] of values.entries()) {
      await rows.getByPlaceholder("name").nth(index).fill(key);
      await rows.getByPlaceholder("value").nth(index).fill(value);
    }
  }

  test("holds values and offers them to the next node", async ({ page }) => {
    await newFlow(page);
    await addConstants(page, "Config", [["path", "/echo"]]);

    await page.getByRole("button", { name: "Test this node" }).click();

    const table = page.getByRole("table", { name: "How the next node uses this" });
    await expect(table.locator("tr").filter({ hasText: "{{Config.path}}" })).toContainText(
      "/echo"
    );
  });

  test("needs no connection, and does not claim to", async ({ page }) => {
    await newFlow(page);
    await addConstants(page, "Config", [["a", "1"]]);

    // every other kind warns on the card until one is chosen
    await expect(node(page, "Config")).not.toContainText("no connection chosen");
    await expect(page.getByLabel("Node connection")).toHaveCount(0);

    await page.getByRole("button", { name: "Test this node" }).click();
    await expect(page.getByLabel("What came back")).toContainText('"a": "1"');
  });

  test("a request node really sends what the constant holds", async ({ page }) => {
    await newFlow(page);
    await addConstants(page, "Config", [["who", "ada"]]);
    await addRequestNode(page, "Send", "/echo", '{"who": "{{Config.who}}"}');
    await connect(page, "Config", "Send");

    await node(page, "Send").click();
    await page.getByRole("button", { name: "Test this node" }).click();

    await expect(page.getByLabel("What was sent")).toContainText('{"who": "ada"}');
    await expect(page.getByLabel("What was sent")).not.toContainText("{{Config");
  });

  test("a value can be built from an upstream node", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select id from users order by id limit 1");
    await addConstants(page, "Config", [["url", "/users/{{Rows.first.id}}"]]);
    await connect(page, "Rows", "Config");

    await node(page, "Config").click();
    await page.getByRole("button", { name: "Test this node" }).click();

    await expect(page.getByLabel("What came back")).toContainText('"/users/1"');
  });

  test("two rows with the same name are refused rather than one winning", async ({
    page,
  }) => {
    await newFlow(page);
    await addConstants(page, "Config", [
      ["same", "1"],
      ["same", "2"],
    ]);

    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("alert")).toContainText("two values called 'same'");
  });
});

test.describe("checks on a node", () => {
  async function addCheck(
    page: Page,
    path: string,
    operator: string,
    value?: string
  ) {
    // the path is typed last on purpose: filling it opens the next blank row,
    // and everything after would then land in that one instead
    const checks = page.getByRole("group", { name: "Checks" });
    await checks.getByLabel("Comparison").last().click();
    await page.getByRole("option", { name: operator, exact: true }).click();
    if (value !== undefined) {
      await checks.getByLabel("Expected value").last().fill(value);
    }
    await checks.getByLabel("Path to check").last().fill(path);
  }

  test("a failing check reports without failing the node", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select id from users limit 3");
    await addCheck(page, "row_count", "more than", "5");

    await page.getByRole("button", { name: "Test this node" }).click();

    const results = page.getByLabel("Check results");
    await expect(results).toContainText("row_count to be more than 5");
    await expect(results).toContainText("got 3");
    // the node itself still did what it was asked
    await expect(page.getByText("3 rows")).toBeVisible();
  });

  test("a passing check says so", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select id from users limit 3");
    await addCheck(page, "row_count", "is", "3");

    await page.getByRole("button", { name: "Test this node" }).click();

    await expect(page.getByLabel("Check results")).toContainText("row_count to be 3");
    await expect(page.getByLabel("Check results")).not.toContainText("got");
  });

  test("the run summary counts them and the card shows the tally", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select id from users limit 3");
    await addCheck(page, "row_count", "is", "3");
    await addCheck(page, "row_count", "more than", "99");

    await page.getByRole("button", { name: "Run" }).click();

    await expect(page.getByRole("status")).toContainText("1 check failed");
    await expect(page.getByRole("status")).toContainText("row_count to be more than 99");
    await expect(node(page, "Rows")).toContainText("1/2 checks passed");
    // and the flow did not stop
    await expect(page.getByRole("status")).toContainText("1 succeeded");
  });

  test("a check on what a node receives reads the upstream node", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select id from users limit 3");
    await addRequestNode(page, "Send", "/echo");
    await connect(page, "Rows", "Send");

    await node(page, "Send").click();
    const checks = page.getByRole("group", { name: "Checks" });
    await checks.getByLabel("What to check").last().click();
    await page.getByRole("option", { name: "it receives" }).click();
    await addCheck(page, "Rows.row_count", "is", "3");

    await page.getByRole("button", { name: "Test this node" }).click();

    await expect(page.getByLabel("Check results")).toContainText(
      "Rows.row_count to be 3"
    );
  });

  test("an operator that stands alone takes no value", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select id from users limit 3");
    await addCheck(page, "first.id", "is there");

    const checks = page.getByRole("group", { name: "Checks" });
    await expect(checks.getByLabel("Expected value").first()).toBeDisabled();

    await page.getByRole("button", { name: "Test this node" }).click();
    await expect(page.getByLabel("Check results")).toContainText("first.id to be there");
  });
});

test.describe("a websocket source", () => {
  async function addSocket(page: Page, name: string, path: string) {
    await page.getByRole("button", { name: "Websocket" }).click();
    await page.getByLabel("Node name").fill(name);
    await page.getByLabel("Node connection").click();
    await page.getByRole("option", { name: "Echo API" }).click();
    await page.getByLabel("Socket path").fill(path);
  }

  const feed = (page: Page) => page.getByLabel("Feed", { exact: true });

  test("subscribes from the browser and collects what arrives", async ({ page }) => {
    await newFlow(page);
    await addSocket(page, "Stream", "/stream");

    await page.getByRole("button", { name: "Connect", exact: true }).click();

    await expect(feed(page)).toContainText('"value"', { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
    await expect(page.getByText(/\d+ received/)).toBeVisible();
  });

  test("disconnecting stops it", async ({ page }) => {
    await newFlow(page);
    await addSocket(page, "Stream", "/stream");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(feed(page)).toContainText('"value"', { timeout: 20_000 });

    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible();

    // whatever arrived is still there to look at after stopping
    await expect(feed(page)).toBeVisible();
  });

  test("running the flow reports it as the browser's job", async ({ page }) => {
    await newFlow(page);
    await addSocket(page, "Stream", "/stream");

    await page.getByRole("button", { name: "Run" }).click();

    await expect(node(page, "Stream")).toHaveAttribute("data-state", "live", {
      timeout: 20_000,
    });
    await expect(node(page, "Stream")).toContainText("runs in your browser");
  });

  test("a request node cannot be fed from it", async ({ page }) => {
    await newFlow(page);
    await addSocket(page, "Stream", "/stream");
    await addRequestNode(page, "Notify", "/echo");
    await connect(page, "Stream", "Notify");

    await page.getByRole("button", { name: "Save" }).click();

    // the server could never resolve a reference to a value living in a tab
    await expect(page.getByRole("alert")).toContainText("runs in your browser");
    await expect(page.getByRole("alert")).toContainText("'Notify' cannot read it");
  });

  test("it is not offered controls that would do nothing", async ({ page }) => {
    await newFlow(page);
    await addSocket(page, "Stream", "/stream");

    // the server never executes it, so a check on it could never run
    await expect(page.getByRole("group", { name: "Checks" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Test this node" })).toHaveCount(0);
  });
});

test.describe("a graph node", () => {
  async function joinTo(page: Page, from: string, to: string) {
    await connect(page, from, to);
    await node(page, to).click();
  }

  test("draws a live websocket as it arrives", async ({ page }) => {
    await newFlow(page);
    await page.getByRole("button", { name: "Websocket" }).click();
    await page.getByLabel("Node name").fill("Stream");
    await page.getByLabel("Node connection").click();
    await page.getByRole("option", { name: "Echo API" }).click();
    await page.getByLabel("Socket path").fill("/stream");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByLabel("Feed", { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await joinTo(page, "Stream", "Chart 1");

    // the fields come from what actually arrived, not from a schema
    const series = page.getByRole("group", { name: "Series" });
    await expect(series.getByLabel("value")).toBeVisible();
    await series.getByLabel("value").check();

    await expect(page.getByLabel(/value by/)).toBeVisible();
    await expect(page.getByText(/\d+ of \d+ points/)).toBeVisible();

    // and it keeps growing while the feed runs
    const first = await page.getByText(/\d+ of \d+ points/).textContent();
    await expect
      .poll(async () => page.getByText(/\d+ of \d+ points/).textContent(), {
        timeout: 15_000,
      })
      .not.toBe(first);
  });

  test("draws the rows a query returned", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select id, total from orders order by id");
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await joinTo(page, "Rows", "Chart 1");

    // nothing has run yet, so there is nothing to draw and it says so
    await expect(page.getByText("Nothing to draw yet")).toBeVisible();

    await page.getByRole("button", { name: "Run" }).click();
    await expect(node(page, "Rows")).toHaveAttribute("data-state", "succeeded", {
      timeout: 20_000,
    });

    await node(page, "Chart 1").click();
    await page.getByRole("group", { name: "Series" }).getByLabel("total").check();
    await expect(page.getByLabel(/total by/)).toBeVisible();
  });

  test("only offers fields that hold numbers", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select id, name from users order by id");
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await joinTo(page, "Rows", "Chart 1");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(node(page, "Rows")).toHaveAttribute("data-state", "succeeded", {
      timeout: 20_000,
    });
    await node(page, "Chart 1").click();

    const series = page.getByRole("group", { name: "Series" });
    await expect(series.getByLabel("id")).toBeVisible();
    // a line through people's names would draw nothing
    await expect(series.getByLabel("name")).toHaveCount(0);
  });

  test("two series get a legend, so identity is never colour alone", async ({ page }) => {
    await newFlow(page);
    await addQueryNode(page, "Rows", "select id, total, user_id from orders order by id");
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await joinTo(page, "Rows", "Chart 1");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(node(page, "Rows")).toHaveAttribute("data-state", "succeeded", {
      timeout: 20_000,
    });

    await node(page, "Chart 1").click();
    const series = page.getByRole("group", { name: "Series" });
    await series.getByLabel("total").check();
    await expect(page.getByRole("list", { name: "Series" })).toHaveCount(0);

    await series.getByLabel("user_id").check();
    const legend = page.getByRole("list", { name: "Series" });
    await expect(legend).toContainText("total");
    await expect(legend).toContainText("user_id");
  });

  test("it needs no connection and is offered no checks", async ({ page }) => {
    await newFlow(page);
    await page.getByRole("button", { name: "Graph", exact: true }).click();

    await expect(page.getByLabel("Node connection")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Checks" })).toHaveCount(0);
    await expect(node(page, "Chart 1")).not.toContainText("no connection chosen");
  });
});
