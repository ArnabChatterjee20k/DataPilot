import { expect, test, type Page } from "./fixtures";

import { API_URL, deleteAllConnections, openPlayground } from "./helpers";
import { seedRedis } from "./redisSeed";

/** A Redis node in a flow: set up, tested, and read downstream. */
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:56379/0";

let available = true;

test.beforeAll(async ({ request }) => {
  const probe = await request.post(`${API_URL}/connections/test`, {
    data: { source: "redis", connection_uri: REDIS_URL },
  });
  available = probe.ok() && (await probe.json()).reachable === true;
  if (available) await seedRedis(REDIS_URL);
});

test.beforeEach(async ({ request }) => {
  test.skip(!available, `no Redis at ${REDIS_URL}`);
  await deleteAllConnections(request);
  await request.post(`${API_URL}/connections`, {
    data: { source: "redis", name: "Cache", connection_uri: REDIS_URL },
  });
});

async function addRedisNode(page: Page, name: string, command: string) {
  await openPlayground(page);
  await page.getByRole("button", { name: "New flow" }).click();
  await expect(page.getByTestId("flow-canvas")).toBeVisible();

  await page.getByRole("button", { name: "Redis", exact: true }).click();
  await page.getByLabel("Node name").fill(name);
  await page.getByLabel("Node connection").click();
  await page.getByRole("option", { name: "Cache" }).click();
  await page.getByLabel("Node command").fill(command);
}

test("a Redis node reads a key and offers its JSON by field", async ({ page }) => {
  await addRedisNode(page, "Session", "GET session:abc");

  await expect(page.getByTestId("flow-node-Session")).toContainText("GET session:abc");

  await page.getByRole("button", { name: "Test this node" }).click();

  await expect(page.getByLabel("What was sent")).toHaveText("GET session:abc");
  await expect(page.getByText("{{Session.json.ip}}")).toBeVisible();
  await expect(page.getByText("10.0.0.4").first()).toBeVisible();
});

test("a write on a read-only connection is refused on the node", async ({ page }) => {
  await addRedisNode(page, "Store", "SET greeting changed");

  await page.getByRole("button", { name: "Test this node" }).click();

  await expect(page.getByText("is read-only").first()).toBeVisible();
});
