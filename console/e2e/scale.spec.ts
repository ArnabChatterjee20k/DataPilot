import { expect, test } from "@playwright/test";

import {
  createSqliteConnection,
  deleteAllConnections,
  openPlayground,
  openTable,
  waitForRows,
  type SeededConnection,
} from "./helpers";

let connection: SeededConnection;

test.beforeEach(async ({ request }) => {
  await deleteAllConnections(request);
  connection = await createSqliteConnection(request, { readOnly: false });
});

test.describe("virtualised rows", () => {
  test("mounts a window of a large page, not all of it", async ({ page }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "orders");
    await waitForRows(page);

    await expect(page.getByRole("status")).toContainText("100 rows");

    const mounted = await page.locator("table tbody tr[data-index]").count();
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(100);
  });

  test("scrolling reaches rows that were never mounted", async ({ page }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "orders");
    await waitForRows(page);

    await expect(page.getByText("Order note 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Order note 99", { exact: true })).toHaveCount(0);

    const grid = page.getByRole("grid", { name: "Query results" });
    await grid.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));

    await expect(page.getByText("Order note 99", { exact: true })).toBeVisible();
  });

  test("a small page is not windowed", async ({ page }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await expect(page.locator("table tbody tr")).toHaveCount(6);
    await expect(page.locator("table tbody tr[data-index]")).toHaveCount(0);
  });

  test("keyboard navigation still reaches a windowed row", async ({ page }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "orders");
    await waitForRows(page);

    const grid = page.getByRole("grid", { name: "Query results" });
    await grid.click();
    for (let index = 0; index < 80; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", { name: "Row detail" })).toBeVisible();
  });
});

test.describe("change awareness", () => {
  test("marks a row that changed since the last load", async ({ page, request }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await expect(page.locator("tr[data-changed]")).toHaveCount(0);

    // change one row behind the UI's back, then reload
    const response = await request.get(
      `http://127.0.0.1:8010/connection/${connection.uid}/entities/users/queries`,
      {
        params: {
          query: "UPDATE users SET status = 'archived' WHERE name = 'Bob Miller'",
          allow_writes: "true",
        },
      }
    );
    expect(response.ok(), await response.text()).toBeTruthy();

    await page.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByText("archived")).toBeVisible();

    const changed = page.locator("tr[data-changed]");
    await expect(changed).toHaveCount(1);
    await expect(changed).toContainText("Bob Miller");
  });

  test("marks a row that is new since the last load", async ({ page, request }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    const response = await request.get(
      `http://127.0.0.1:8010/connection/${connection.uid}/entities/users/queries`,
      {
        params: {
          query:
            "INSERT INTO users (name, email, status, created_at) VALUES " +
            "('Zoe New', 'zoe@example.com', 'active', '2024-03-09T10:00:00')",
          allow_writes: "true",
        },
      }
    );
    expect(response.ok(), await response.text()).toBeTruthy();

    await page.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByText("Zoe New")).toBeVisible();

    await expect(page.locator("tr[data-changed]")).toContainText("Zoe New");
  });

  test("an unchanged reload marks nothing", async ({ page }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await page.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByRole("status")).toContainText("6 rows");

    await expect(page.locator("tr[data-changed]")).toHaveCount(0);
  });
});

test.describe("saved views", () => {
  test("saving is only offered once there is something to save", async ({ page }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await page.getByRole("button", { name: "Saved views" }).click();
    await expect(page.getByText("None yet.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "View name" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByPlaceholder("Search this table…").fill("active");
    await expect(page.getByText(/search/)).toBeVisible();

    await page.getByRole("button", { name: "Saved views" }).click();
    await expect(page.getByRole("textbox", { name: "View name" })).toBeVisible();
  });

  test("saves, re-applies and deletes a view", async ({ page }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    const statusHeader = page.locator("thead th").filter({ hasText: "status" });
    await statusHeader.hover();
    await statusHeader.getByRole("button", { name: /Options for status/ }).click();
    await page.getByRole("textbox", { name: "Filter status" }).fill("suspended");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    await expect(page.locator("table tbody tr")).toHaveCount(2);

    await page.getByRole("button", { name: "Saved views" }).click();
    await page.getByRole("textbox", { name: "View name" }).fill("Suspended only");
    await page.getByRole("button", { name: "Save view" }).click();

    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(6);

    await page.getByRole("button", { name: "Saved views" }).click();
    await page.getByRole("menuitem", { name: /Suspended only/ }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(2);

    await page.getByRole("button", { name: "Saved views" }).click();
    await page.getByRole("button", { name: "Delete view Suspended only" }).click();
    await expect(page.getByText("None yet.")).toBeVisible();
  });

  test("a view survives a reload", async ({ page }) => {
    await openPlayground(page);
    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await page.getByPlaceholder("Search this table…").fill("Alice");
    await expect(page.locator("table tbody tr")).toHaveCount(1);

    await page.getByRole("button", { name: "Saved views" }).click();
    await page.getByRole("textbox", { name: "View name" }).fill("Just Alice");
    await page.getByRole("button", { name: "Save view" }).click();

    await page.reload();
    await waitForRows(page);

    await page.getByRole("button", { name: "Saved views" }).click();
    await expect(page.getByRole("menuitem", { name: /Just Alice/ })).toBeVisible();
  });
});
