import { expect, test } from "./fixtures";

import {
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

test.describe("command palette", () => {
  test("opens with the keyboard and jumps to a table", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    // wait until the palette has tables to offer
    await expect(
      page.getByRole("button", { name: connection.name }).first()
    ).toBeVisible();

    await page.keyboard.press("ControlOrMeta+k");
    const search = page.getByRole("textbox", { name: "Command palette search" });
    await expect(search).toBeVisible();

    await search.fill("orders");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("tab", { name: /orders/ })).toBeVisible();
    await waitForRows(page);
  });

  test("says when nothing matches", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "Command palette" }).click();

    await page
      .getByRole("textbox", { name: "Command palette search" })
      .fill("zzz-nothing");

    await expect(page.getByText(/Nothing matches/)).toBeVisible();
  });

  test("closes on Escape", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("keyboard navigation", () => {
  test("slash focuses the table search", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await page.keyboard.press("/");
    await expect(page.getByPlaceholder("Search this table…")).toBeFocused();
  });

  test("arrow keys move the focused cell and Enter expands the row", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await page.getByRole("grid", { name: "Query results" }).click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", { name: "Row detail" })).toBeVisible();
  });
});

test.describe("comparing rows", () => {
  test("selecting two rows offers a diff that highlights the differences", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await page.getByRole("checkbox", { name: "Select row 1" }).click();
    await page.getByRole("checkbox", { name: "Select row 2" }).click();

    await expect(page.getByText("2 rows selected")).toBeVisible();
    await page.getByRole("button", { name: "Compare" }).click();

    await expect(page.getByRole("heading", { name: "Compare rows" })).toBeVisible();
    await expect(page.getByText(/columns differ/)).toBeVisible();
    await expect(page.getByText("Row A")).toBeVisible();
    await expect(page.getByText("Row B")).toBeVisible();
  });

  test("compare is only offered for exactly two rows", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await page.getByRole("checkbox", { name: "Select row 1" }).click();
    await expect(page.getByRole("button", { name: "Compare" })).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Select row 2" }).click();
    await expect(page.getByRole("button", { name: "Compare" })).toBeVisible();

    await page.getByRole("checkbox", { name: "Select row 3" }).click();
    await expect(page.getByRole("button", { name: "Compare" })).toHaveCount(0);
  });
});

test.describe("stats panel", () => {
  test("reports null share, cardinality and top values", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await page.getByRole("button", { name: "Stats" }).click();

    const stats = page.getByRole("region", { name: "Column statistics" });
    await expect(stats.getByText("6 rows")).toBeVisible();
    await expect(stats.getByText("3 distinct").first()).toBeVisible();
    // one of six users has a null email
    await expect(stats.getByText("16.67% null")).toBeVisible();
    // status repeats, so its values are ranked
    await expect(stats.getByText("active", { exact: false }).first()).toBeVisible();
    // id is unique per row, so it has nothing worth ranking
    await expect(stats.getByText("(empty)")).toBeVisible();
  });
});

test.describe("query plan", () => {
  test("shows the plan and flags a scan without an index", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await startQuery(page, connection.name);

    await page.getByLabel("SQL editor").fill("SELECT * FROM users WHERE name = 'Bob'");
    await page.getByRole("button", { name: "Run" }).click();
    await waitForRows(page);

    await page.getByRole("button", { name: "Plan" }).click();

    const plan = page.getByRole("region", { name: "Query plan" });
    await expect(plan.getByText("no index used")).toBeVisible();
    await expect(plan.getByText(/Sequential scan/)).toBeVisible();
    await expect(plan.getByRole("cell", { name: "sequential" })).toBeVisible();
  });

  test("reports an index scan when one is available", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await startQuery(page, connection.name);

    await page
      .getByLabel("SQL editor")
      .fill("SELECT * FROM users WHERE email = 'bob@example.com'");
    await page.getByRole("button", { name: "Run" }).click();
    await waitForRows(page);

    await page.getByRole("button", { name: "Plan" }).click();
    await expect(
      page.getByRole("region", { name: "Query plan" }).getByText("uses an index")
    ).toBeVisible();
  });

  test("the plan itself is readable, in the database's own words", async ({
    page,
    pageErrors: _errors,
  }) => {
    await openPlayground(page);
    await startQuery(page, connection.name);

    await page.getByLabel("SQL editor").fill("SELECT * FROM users WHERE name = 'Bob'");
    await page.getByRole("button", { name: "Run" }).click();
    await waitForRows(page);
    await page.getByRole("button", { name: "Plan" }).click();

    // everything above the plan is an opinion about it; this is the plan
    const source = page.getByLabel("Query plan source");
    await expect(source).toContainText("SCAN users");
    await expect(source).not.toContainText("{");

    await page.getByRole("button", { name: "JSON", exact: true }).click();
    await expect(source).toContainText("{");
  });
});

test.describe("column controls", () => {
  test("warns before filtering on a column with no index", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    const header = page.locator("thead th").filter({ hasText: "status" });
    await header.hover();
    await header.getByRole("button", { name: /Options for status/ }).click();

    await expect(page.getByText(/Not indexed/)).toBeVisible();
  });

  test("filters from the column menu", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    const header = page.locator("thead th").filter({ hasText: "name" }).first();
    await header.hover();
    await header.getByRole("button", { name: /Options for name/ }).click();

    await page.getByRole("textbox", { name: "Filter name" }).fill("Wu");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    await expect(page.getByText(/name contains/)).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(page.getByText("Dan Wu")).toBeVisible();
  });

  test("reordering a column persists across a reload", async ({ page, pageErrors: _errors }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    const headers = () =>
      page.locator("thead th:not([aria-hidden])").allInnerTexts();
    const before = await headers();
    expect(before[1]).toContain("id");
    expect(before[2]).toContain("name");

    await page
      .locator("thead th")
      .filter({ hasText: "name" })
      .first()
      .dragTo(page.locator("thead th").filter({ hasText: "id" }).first());

    await expect
      .poll(async () => (await headers())[1])
      .toContain("name");

    await page.reload();
    await waitForRows(page);
    await expect.poll(async () => (await headers())[1]).toContain("name");
  });
});
