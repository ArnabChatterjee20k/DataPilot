import { expect, test } from "./fixtures";

import {
  API_URL,
  createSqliteConnection,
  deleteAllConnections,
  expandConnection,
  openPlayground,
  startQuery,
} from "./helpers";

/**
 * Whether a connection actually answers should be on screen before anything is
 * run against it, and a query that fails because the database is not there
 * should not read like a query that was simply wrong.
 */

/** A Postgres connection pointed at a port with nothing behind it. */
async function createDeadConnection(
  request: import("@playwright/test").APIRequestContext,
  name: string
) {
  const created = await request.post(`${API_URL}/connections`, {
    data: {
      source: "postgres",
      name,
      connection_uri: "postgresql://nobody:nobody@127.0.0.1:1/nothing",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  await deleteAllConnections(request);
});

test.describe("connection health in the sidebar", () => {
  test("a working connection reports itself reachable", async ({ page, request }) => {
    const connection = await createSqliteConnection(request);
    await openPlayground(page);

    await expect(page.getByRole("button", { name: /^Reachable/ })).toBeVisible();
    // the dot carries the detail, so it is readable without opening anything
    await expect(page.getByRole("button", { name: /^Reachable/ })).toHaveAttribute(
      "title",
      /Reachable/
    );
    expect(connection.name).toBeTruthy();
  });

  test("an unreachable connection says so, and why, before anything is run", async ({
    page,
    request,
  }) => {
    await createDeadConnection(request, "Dead postgres");
    await openPlayground(page);

    const dot = page.getByRole("button", { name: /^Unreachable/ });
    await expect(dot).toBeVisible({ timeout: 20_000 });

    await expandConnection(page, "Dead postgres");
    await expect(page.getByText("Cannot reach this connection")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Try this connection again" })
    ).toBeVisible();
  });
});

test.describe("a query against a database that is not there", () => {
  test("reads as a connection failure, with a way to retest", async ({
    page,
    request,
  }) => {
    await createDeadConnection(request, "Dead postgres");
    await openPlayground(page);
    await startQuery(page, "Dead postgres");

    await page.getByLabel("SQL editor").fill("SELECT 1");
    await page.getByRole("button", { name: "Run", exact: true }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Cannot reach the database", { timeout: 20_000 });
    await expect(alert).not.toContainText("Query failed");

    await alert.getByRole("button", { name: "Test connection" }).click();
    await expect(alert).toContainText("Still unreachable", { timeout: 20_000 });
  });

  test("a query that is simply wrong still reads as a query failure", async ({
    page,
    request,
  }) => {
    const connection = await createSqliteConnection(request);
    await openPlayground(page);
    await startQuery(page, connection.name);

    await page.getByLabel("SQL editor").fill("SELECT * FROM no_such_table");
    await page.getByRole("button", { name: "Run", exact: true }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Query failed");
    await expect(
      alert.getByRole("button", { name: "Test connection" })
    ).toHaveCount(0);
  });
});
