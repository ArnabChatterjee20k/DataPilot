import { expect, test } from "@playwright/test";

import {
  createSqliteConnection,
  deleteAllConnections,
  openPlayground,
  openTable,
  startQuery,
  waitForRows,
  type SeededConnection,
} from "./helpers";

/**
 * Captures the states worth looking at with human eyes. It asserts little on
 * purpose — its job is to produce screenshots for review, not to gate CI.
 */
test.describe("visual sweep", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  let connection: SeededConnection;

  test.beforeEach(async ({ request }) => {
    await deleteAllConnections(request);
    connection = await createSqliteConnection(request, { environment: "production" });
  });

  test("captures the main states", async ({ page }, testInfo) => {
    const shot = async (name: string) => {
      await page.screenshot({
        path: testInfo.outputPath(`${name}.png`),
        fullPage: false,
      });
    };

    await openPlayground(page);
    await shot("01-empty-workspace");

    await openTable(page, connection.name, "users");
    await waitForRows(page);
    await shot("02-table-view");

    const aliceRow = page.locator("table tbody tr").filter({ hasText: "Alice Johnson" });
    const statusCell = aliceRow.locator("td").filter({ hasText: /^active$/ }).first();
    await statusCell.hover();
    await shot("03-cell-hover-actions");

    await statusCell.getByRole("button", { name: "Filter by this value" }).click();
    await expect(page.getByText("status = active")).toBeVisible();
    await shot("04-filter-applied");

    await page.getByRole("button", { name: "Clear all" }).click();
    await aliceRow.hover();
    await aliceRow.getByRole("button", { name: /Expand row/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // the dialog fades and slides in; capture it at rest
    await page.waitForTimeout(400);
    await shot("05-row-detail");
    await page.keyboard.press("Escape");

    await openTable(page, connection.name, "orders");
    await waitForRows(page);
    await shot("06-wide-table-pagination");

    await startQuery(page, connection.name);
    await page.getByLabel("SQL editor").fill("DELETE FROM users");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText("Query failed")).toBeVisible();
    await shot("07-read-only-rejection");

    await page.getByLabel("SQL editor").fill("SELECT * FROM nope");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText("Query failed")).toBeVisible();
    await shot("08-query-error");

    await page
      .getByLabel("SQL editor")
      .fill("SELECT id, name, email FROM users WHERE id > 99");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText("0 rows returned")).toBeVisible();
    await shot("09-zero-rows");
  });
});
