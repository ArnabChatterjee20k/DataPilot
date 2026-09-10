import { expect, test } from "@playwright/test";

import { API_URL } from "./helpers";
import { startUpstream, UPSTREAM_URL, type Upstream } from "./upstream";
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

    await openTable(page, connection.name, "users");
    await waitForRows(page);

    await page.getByRole("button", { name: "Stats" }).click();
    await expect(page.getByRole("region", { name: "Column statistics" })).toBeVisible();
    await shot("10-stats-panel");

    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByRole("region", { name: "Query plan" })).toBeVisible();
    await shot("11-plan-panel");

    await page.getByRole("button", { name: "Data" }).click();
    await page.getByRole("checkbox", { name: "Select row 1" }).click();
    await page.getByRole("checkbox", { name: "Select row 2" }).click();
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page.getByRole("heading", { name: "Compare rows" })).toBeVisible();
    await page.waitForTimeout(400);
    await shot("12-row-compare");
    await page.keyboard.press("Escape");

    await page.keyboard.press("ControlOrMeta+k");
    await expect(
      page.getByRole("textbox", { name: "Command palette search" })
    ).toBeVisible();
    await page.waitForTimeout(400);
    await shot("13-command-palette");
    await page.keyboard.press("Escape");

    await page.getByPlaceholder("Search this table…").fill("active");
    await expect(page.getByText("status")).toBeVisible();
    await page.getByRole("button", { name: "Saved views" }).click();
    await page.getByRole("textbox", { name: "View name" }).fill("Active users");
    await page.getByRole("button", { name: "Save view" }).click();
    await page.getByRole("button", { name: "Saved views" }).click();
    await page.waitForTimeout(300);
    await shot("14-saved-views");
    await page.keyboard.press("Escape");

    await openTable(page, connection.name, "orders");
    await waitForRows(page);
    await shot("15-virtualised-large-page");
  });

  test("captures the API client", async ({ page, request }, testInfo) => {
    const shot = async (name: string) => {
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    };

    const upstream = await startUpstream();
    try {
      const name = `Upstream ${Date.now()}`;
      await request.post(`${API_URL}/connections`, {
        data: { source: "api", name, connection_uri: UPSTREAM_URL },
      });

      await openPlayground(page);
      await page.getByRole("button", { name, exact: true }).click();
      await page.getByRole("button", { name: "New request" }).click();

      await page.getByLabel("Request name").fill("Echo check");
      await page.getByLabel("Request path").fill("/echo");
      await page
        .getByRole("tablist", { name: "Request sections" })
        .getByRole("tab", { name: /Headers/ })
        .click();
      await page.getByLabel("Header key 1").fill("X-Trace");
      await page.getByLabel("Header value 1").fill("abc123");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("200");
      await shot("16-api-request");

      await page.getByRole("button", { name: "WebSocket" }).click();
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByLabel("Socket state")).toContainText("open");
      await page.getByLabel("Message to send").fill("hello");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(
        page.getByRole("list", { name: "Socket messages" })
      ).toContainText("echo:hello");
      await shot("17-websocket-console");
    } finally {
      await upstream.stop();
    }
  });
});
