import { expect, type Page, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";

import { seedDbPath } from "./global-setup";

export const API_URL = "http://127.0.0.1:8010";

export interface SeededConnection {
  uid: string;
  name: string;
}

/**
 * Upload the seeded SQLite file and register a connection for it, through the
 * real API, so tests start from the state a user would have after onboarding.
 */
export async function createSqliteConnection(
  request: APIRequestContext,
  options: { name?: string; readOnly?: boolean; environment?: string } = {}
): Promise<SeededConnection> {
  const upload = await request.post(`${API_URL}/bucket`, {
    multipart: {
      file: {
        name: "e2e-seed.db",
        mimeType: "application/octet-stream",
        buffer: fs.readFileSync(seedDbPath),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const bucket = await upload.json();

  const name = options.name ?? `E2E SQLite ${Date.now()}`;
  const created = await request.post(`${API_URL}/connections`, {
    data: {
      source: "sqlite",
      name,
      connection_uri: bucket.connection_uri,
      read_only: options.readOnly ?? true,
      environment: options.environment ?? "local",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const connection = await created.json();
  return { uid: connection.uid, name };
}

export async function deleteAllConnections(request: APIRequestContext) {
  const response = await request.get(`${API_URL}/connections`);
  if (!response.ok()) return;
  const body = await response.json();
  for (const connection of body.connections ?? []) {
    await request.delete(`${API_URL}/connections/${connection.uid}`);
  }
}

/**
 * Each test gets a fresh browser context, so localStorage already starts empty
 * - clearing it on every navigation would also wipe state a reload should keep.
 */
export async function openPlayground(page: Page) {
  await page.goto("/playground");
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
}

/** Expand a connection if it is not already open, so calling it twice is safe. */
export async function expandConnection(page: Page, name: string) {
  const node = page.getByRole("button", { name, exact: true }).first();
  await expect(node).toBeVisible();
  if ((await node.getAttribute("aria-expanded")) !== "true") await node.click();
}

export async function openTable(page: Page, connectionName: string, table: string) {
  await expandConnection(page, connectionName);
  const entry = page.getByRole("button", { name: table, exact: true });
  await expect(entry).toBeVisible();
  await entry.click();
}

/** Start a query tab against a connection. */
export async function startQuery(page: Page, connectionName: string) {
  await page.getByRole("button", { name: "New query" }).first().click();
  await page.getByRole("combobox", { name: "Connection" }).click();
  await page.getByRole("option", { name: connectionName }).click();
}

/** Wait until the grid has finished loading and shows a body row. */
export async function waitForRows(page: Page) {
  await expect(page.locator("table tbody tr").first()).toBeVisible();
}
