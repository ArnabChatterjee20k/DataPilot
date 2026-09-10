import { expect, test } from "./fixtures";

import {
  API_URL,
  createSqliteConnection,
  deleteAllConnections,
  openPlayground,
  openTable,
  startQuery,
  waitForRows,
  type SeededConnection,
} from "./helpers";

let connection: SeededConnection;

test.beforeEach(async ({ request }) => {
  await deleteAllConnections(request);
  connection = await createSqliteConnection(request);
});

test.describe("browsing a table", () => {
  test("shows the connection, its tables, and the rows of one", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);

    await expect(page.getByText(connection.name)).toBeVisible();
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await expect(page.getByRole("tab", { name: /users/ })).toBeVisible();
    await expect(page.getByText("Alice Johnson")).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(6);
  });

  test("labels each column with its type and marks the primary key", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    const idHeader = page.locator("thead th").filter({ hasText: "id" }).first();
    await expect(idHeader).toContainText("number");
    await expect(idHeader).toContainText("pk");

    const createdHeader = page.locator("thead th").filter({ hasText: "created_at" });
    await expect(createdHeader).toContainText("time");
  });

  test("distinguishes null from an empty string", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await expect(page.getByText("null", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("empty", { exact: true }).first()).toBeVisible();
  });

  test("masks a column that looks like a credential until revealed", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    // rows arrive newest-first, so Alice is the last of the six
    const aliceRow = page.locator("table tbody tr").filter({ hasText: "Alice Johnson" });
    const masked = aliceRow.getByRole("button", { name: /••••/ });
    await expect(masked).toBeVisible();
    await expect(page.getByText("tok_alice")).toHaveCount(0);

    await masked.click();
    await expect(aliceRow.getByText("tok_alice")).toBeVisible();
  });

  test("reports row count and execution time", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    const status = page.getByRole("status");
    await expect(status).toContainText("6 rows");
    await expect(status).toContainText(/ms|s$/);
  });
});

test.describe("filtering", () => {
  test("clicking a cell filters by its value and the filter can be cleared", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    const aliceRow = page.locator("table tbody tr").filter({ hasText: "Alice Johnson" });
    const statusCell = aliceRow.locator("td").filter({ hasText: /^active$/ }).first();
    await statusCell.hover();
    await statusCell.getByRole("button", { name: "Filter by this value" }).click();

    await expect(page.getByText("status = active")).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(3);

    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(6);
  });

  test("stacks filters with AND", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    const statusHeader = page.locator("thead th").filter({ hasText: "status" });
    await statusHeader.hover();
    await statusHeader.getByRole("button", { name: /Options for status/ }).click();
    await page.getByRole("menuitem", { name: "Filter: is not null" }).click();

    const emailHeader = page.locator("thead th").filter({ hasText: "email" });
    await emailHeader.hover();
    await emailHeader.getByRole("button", { name: /Options for email/ }).click();
    await page.getByRole("menuitem", { name: "Filter: is null" }).click();

    await expect(page.getByText("and", { exact: true })).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(page.getByText("Erin Blake")).toBeVisible();
  });

  test("a filter that matches nothing says so", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await page.getByPlaceholder("Search this table…").fill("zzzz-no-such-value");
    await expect(page.getByText("No rows match these filters")).toBeVisible();
  });

  test("search survives a value containing a quote", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await page.getByPlaceholder("Search this table…").fill("O'Brien");
    await expect(page.getByText("Carol O'Brien")).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(1);
  });
});

test.describe("pagination", () => {
  test("pages forward and back with a correct page number", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "orders");
    await waitForRows(page);

    // rows are windowed past 60, so the status bar is the source of truth for
    // how many came back, not how many happen to be mounted
    await expect(page.getByText("1 / 2")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("100 rows");

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("2 / 2")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("20 rows");
    await expect(page.locator("table tbody tr")).toHaveCount(20);

    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(page.getByText("1 / 2")).toBeVisible();
  });

  test("previous is disabled on the first page", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "orders");
    await waitForRows(page);

    await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });
});

test.describe("running queries", () => {
  test("runs a query typed into the editor", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await startQuery(page, connection.name);

    await page.getByLabel("SQL editor").fill("SELECT name, status FROM users");
    await page.getByRole("button", { name: "Run" }).click();

    await waitForRows(page);
    await expect(page.locator("table tbody tr")).toHaveCount(6);
    await expect(page.getByRole("status")).toContainText("6 rows");
  });

  test("shows the error instead of an empty grid when the query is wrong", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await startQuery(page, connection.name);

    await page.getByLabel("SQL editor").fill("SELECT * FROM table_that_is_not_here");
    await page.getByRole("button", { name: "Run" }).click();

    await expect(page.getByText("Query failed")).toBeVisible();
    await expect(page.getByText(/Table not found/)).toBeVisible();
  });

  test("refuses a write on a read-only connection", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await startQuery(page, connection.name);

    await page.getByLabel("SQL editor").fill("DELETE FROM users");
    await page.getByRole("button", { name: "Run" }).click();

    await expect(page.getByText("Query failed")).toBeVisible();
    await expect(page.getByText(/This connection is read-only/)).toBeVisible();
  });

  test("flags a dangerous statement once writes are allowed", async ({ page, request, pageErrors: _errors }) => {
    const writable = await createSqliteConnection(request, {
      name: "E2E Writable",
      readOnly: false,
    });

    await openPlayground(page);
    await startQuery(page, writable.name);

    await page
      .getByLabel("SQL editor")
      .fill("UPDATE users SET status = 'active' WHERE id = 1");
    await page.getByRole("button", { name: "Run" }).click();

    await expect(page.getByRole("status")).toContainText("UPDATE");
    await expect(page.getByRole("status")).toContainText("caution");
  });
});

test.describe("row inspection", () => {
  test("double-clicking a row opens the detail panel", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    const aliceRow = page.locator("table tbody tr").filter({ hasText: "Alice Johnson" });
    await aliceRow.hover();
    await aliceRow.getByRole("button", { name: /Expand row/ }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Row detail" })).toBeVisible();
    await page.getByRole("tab", { name: "JSON" }).click();
    await expect(page.getByText(/"name": "Alice Johnson"/)).toBeVisible();
  });
});

test.describe("columns", () => {
  test("hides and restores a column", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await expect(page.locator("thead th").filter({ hasText: "email" })).toBeVisible();

    await page.getByRole("button", { name: /Columns/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "email" }).click();
    await page.keyboard.press("Escape");

    await expect(page.locator("thead th").filter({ hasText: "email" })).toHaveCount(0);

    await page.getByRole("button", { name: /Columns/ }).click();
    await page.getByRole("button", { name: "Show all" }).click();
    await page.keyboard.press("Escape");

    await expect(page.locator("thead th").filter({ hasText: "email" })).toBeVisible();
  });
});

test.describe("tabs", () => {
  test("opening the same table twice reuses its tab", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);
    await openTable(page, connection.name, "users");

    await expect(page.getByRole("tab", { name: /users/ })).toHaveCount(1);
  });

  test("closing a tab leaves the others intact", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);
    await openTable(page, connection.name, "orders");
    await waitForRows(page);

    await expect(page.getByRole("tab")).toHaveCount(2);
    await page.getByRole("button", { name: "Close orders" }).click();

    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(page.getByRole("tab", { name: /users/ })).toBeVisible();
  });
});

test.describe("connection modal", () => {
  test("offers every supported backend", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();

    await expect(page.getByRole("button", { name: "PostgreSQL" })).toBeVisible();
    await expect(page.getByRole("button", { name: "MySQL" })).toBeVisible();
    await expect(page.getByRole("button", { name: "SQLite file" })).toBeVisible();
    await expect(page.getByRole("button", { name: "HTTP / WebSocket" })).toBeVisible();
  });

  test("asks for a URI for a server backend and a file for SQLite", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();

    await page.getByRole("button", { name: "MySQL" }).click();
    await expect(page.getByLabel("Connection URI")).toHaveAttribute(
      "placeholder",
      /^mysql:\/\//
    );

    await page.getByRole("button", { name: "PostgreSQL" }).click();
    await expect(page.getByLabel("Connection URI")).toHaveAttribute(
      "placeholder",
      /^postgresql:\/\//
    );

    await page.getByRole("button", { name: "HTTP / WebSocket" }).click();
    await expect(page.getByLabel("Base URL")).toHaveAttribute(
      "placeholder",
      /^https:\/\//
    );

    await page.getByRole("button", { name: "SQLite file" }).click();
    await expect(page.getByLabel("Connection URI")).toHaveCount(0);
    await expect(page.getByText("SQLite file", { exact: true }).first()).toBeVisible();
  });

  test("tests a connection before creating it", async ({
    page,
    request,
    pageErrors: _errors,
  }) => {
    const before = (await (await request.get(`${API_URL}/connections`)).json()).total;

    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();
    await page.getByRole("button", { name: "PostgreSQL" }).click();

    // nothing is listening here
    await page
      .getByLabel("Connection URI")
      .fill("postgresql://user:pass@127.0.0.1:1/nothing");
    await page.getByRole("button", { name: "Test connection" }).click();

    await expect(page.getByText("Could not connect")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    const after = (await (await request.get(`${API_URL}/connections`)).json()).total;
    expect(after).toBe(before);
  });

  test("a refused local address hints at the container case", async ({
    page,
    pageErrors: _errors,
  }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();
    await page.getByRole("button", { name: "PostgreSQL" }).click();

    await page
      .getByLabel("Connection URI")
      .fill("postgresql://user:pass@localhost:1/nothing");
    await page.getByRole("button", { name: "Test connection" }).click();

    await expect(page.getByText(/host\.docker\.internal/)).toBeVisible();
  });

  test("an API connection is dialled for real", async ({
    page,
    pageErrors: _errors,
  }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();
    await page.getByRole("button", { name: "HTTP / WebSocket" }).click();

    // nothing is listening, so testing must say so rather than assume success
    await page.getByLabel("Base URL").fill("http://127.0.0.1:1");
    await page.getByRole("button", { name: "Test connection" }).click();

    await expect(page.getByText("Could not connect")).toBeVisible();
  });

  test("a websocket-only base URL is accepted", async ({
    page,
    pageErrors: _errors,
  }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();
    await page.getByRole("button", { name: "HTTP / WebSocket" }).click();

    await page.getByLabel("Name", { exact: true }).fill("Stream");
    await page.getByLabel("Base URL").fill("wss://stream.example.com");
    await page.getByRole("button", { name: "Create connection" }).click();

    await expect(page.getByRole("button", { name: "Stream", exact: true })).toBeVisible();
  });

  test("defaults a new connection to read-only", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();
    await page.getByRole("button", { name: "MySQL" }).click();

    await expect(page.getByRole("checkbox", { name: /Read-only/ })).toBeChecked();
  });
});

test.describe("empty states", () => {
  test("says so when there are no connections", async ({ page, request, pageErrors: _errors }) => {
    await deleteAllConnections(request);
    await openPlayground(page);

    await expect(page.getByText("No connections yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a connection" })).toBeVisible();
  });
});
