import { expect, test } from "./fixtures";

import {
  API_URL,
  createSqliteConnection,
  deleteAllConnections,
  openPlayground,
} from "./helpers";
import { startUpstream, UPSTREAM_URL, type Upstream } from "./upstream";

/**
 * A connection with no statement statistics is the case every setup starts in,
 * so it is the one worth covering here: a database server with the extension
 * enabled is exercised by the Python tests, which can create one.
 */

let upstream: Upstream;

test.beforeAll(async () => {
  upstream = await startUpstream();
});

test.afterAll(async () => {
  await upstream.stop();
});

test.beforeEach(async ({ request }) => {
  await deleteAllConnections(request);
});

async function openSlowQueries(
  page: import("@playwright/test").Page,
  name: string
) {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Slow queries" }).click();
}

test.describe("slow queries", () => {
  test("SQLite says why it has none, rather than showing an empty table", async ({
    page,
    request,
  }) => {
    const connection = await createSqliteConnection(request, { name: "Shop" });
    await openPlayground(page);
    await openSlowQueries(page, connection.name);

    await expect(
      page.getByText("No statement statistics on this connection")
    ).toBeVisible();
    await expect(page.getByText(/no server to keep them/)).toBeVisible();
    await expect(page.getByText(/Use the Plan tab/)).toBeVisible();

    // and there is nothing to snapshot
    await expect(page.getByRole("button", { name: "Snapshot" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reload" })).toBeDisabled();
  });

  test("the tab reopens rather than stacking up", async ({ page, request }) => {
    const connection = await createSqliteConnection(request, { name: "Shop" });
    await openPlayground(page);

    await openSlowQueries(page, connection.name);
    await openSlowQueries(page, connection.name);

    await expect(page.getByRole("tab", { name: /Slow queries/ })).toHaveCount(1);
  });

  test("an API connection is not offered slow queries at all", async ({
    page,
    request,
  }) => {
    await request.post(`${API_URL}/connections`, {
      data: { source: "api", name: "An API", connection_uri: UPSTREAM_URL },
    });

    await openPlayground(page);
    await page.getByRole("button", { name: "Actions for An API" }).click();

    await expect(page.getByRole("menuitem", { name: "Slow queries" })).toHaveCount(0);
    // the menu still has what an API connection can do
    await expect(page.getByRole("menuitem", { name: "Variables" })).toBeVisible();
  });

  test("a database connection is offered them", async ({ page, request }) => {
    const connection = await createSqliteConnection(request, { name: "Shop" });
    await openPlayground(page);
    await page.getByRole("button", { name: `Actions for ${connection.name}` }).click();

    await expect(page.getByRole("menuitem", { name: "Slow queries" })).toBeVisible();
  });
});
