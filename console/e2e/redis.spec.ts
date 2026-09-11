import { expect, test, type Page } from "./fixtures";

import { API_URL, deleteAllConnections, expandConnection, openPlayground } from "./helpers";
import { seedRedis } from "./redisSeed";

/**
 * Against a real Redis, because the point of the browser is showing each type
 * as what it is - and a stub would have to decide those shapes itself.
 */
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:56379/0";

let available = true;

test.beforeAll(async ({ request }) => {
  const probe = await request.post(`${API_URL}/connections/test`, {
    data: { source: "redis", connection_uri: REDIS_URL },
  });
  available = probe.ok() && (await probe.json()).reachable === true;
  // the keys these tests read are put there by the tests, not by whoever last
  // used the container
  if (available) await seedRedis(REDIS_URL);
});

test.beforeEach(async ({ request }) => {
  test.skip(!available, `no Redis at ${REDIS_URL}`);
  await deleteAllConnections(request);

  const created = await request.post(`${API_URL}/connections`, {
    data: { source: "redis", name: "Cache", connection_uri: REDIS_URL },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
});

async function openRedis(page: Page) {
  await openPlayground(page);
  await expandConnection(page, "Cache");
  await page.getByRole("button", { name: "Browse" }).click();
}

const keyRow = (page: Page, name: string) =>
  page.getByRole("listitem").filter({ hasText: name }).first();

/**
 * A channel name nothing else is using.
 *
 * A subscriber from an earlier test can still be attached when the next one
 * runs, which makes any exact subscriber count a coin toss.
 */
const uniqueChannel = () => `ch-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

test.describe("the key browser", () => {
  test("keys are listed with their type and size", async ({ page }) => {
    await openRedis(page);
    await expect(page.getByRole("list", { name: "Keys" })).toBeVisible();

    await expect(keyRow(page, "leaderboard")).toContainText("zset");
    await expect(keyRow(page, "user:7")).toContainText("hash");
    await expect(keyRow(page, "events")).toContainText("strm");
  });

  test("a sorted set keeps its scores, in score order", async ({ page }) => {
    await openRedis(page);
    await keyRow(page, "leaderboard").click();

    const table = page.getByRole("table", { name: "Sorted set members" });
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr").first()).toContainText("bob");
    await expect(table.locator("tbody tr").first()).toContainText("99");
    await expect(table.locator("tbody tr").last()).toContainText("carol");
  });

  test("a hash keeps its fields", async ({ page }) => {
    await openRedis(page);
    await keyRow(page, "user:7").click();

    const table = page.getByRole("table", { name: "Hash fields" });
    await expect(table).toContainText("email");
    await expect(table).toContainText("ada@example.com");
  });

  test("a list keeps its order", async ({ page }) => {
    await openRedis(page);
    await keyRow(page, "queue:jobs").click();

    const rows = page.getByRole("table", { name: "List members" }).locator("tbody tr");
    await expect(rows.first()).toContainText("first");
    await expect(rows.last()).toContainText("third");
  });

  test("a stream keeps its entries and their fields", async ({ page }) => {
    await openRedis(page);
    await keyRow(page, "events").click();

    const table = page.getByRole("table", { name: "Stream entries" });
    await expect(table).toContainText("kind");
    await expect(table).toContainText("signup");
  });

  test("a string shows its value", async ({ page }) => {
    await openRedis(page);
    await keyRow(page, "greeting").click();

    await expect(page.getByLabel("Key value")).toHaveText("hello");
  });

  test("a pattern narrows the list", async ({ page }) => {
    await openRedis(page);
    await page.getByLabel("Key pattern").fill("user:*");
    await page.getByLabel("Key pattern").press("Enter");

    await expect(keyRow(page, "user:7")).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(1);
  });

  test("a pattern matching nothing says so", async ({ page }) => {
    await openRedis(page);
    await page.getByLabel("Key pattern").fill("nothing:*");
    await page.getByLabel("Key pattern").press("Enter");

    await expect(page.getByText(/Nothing matches nothing:\*/)).toBeVisible();
  });
});

test.describe("the dashboard", () => {
  test("reports what the server says about itself", async ({ page }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();

    const stats = page.getByRole("definition").first();
    await expect(stats).toBeVisible();
    await expect(page.getByText("Keyspace hit rate")).toBeVisible();
    await expect(page.getByText("Memory used")).toBeVisible();
    await expect(page.getByRole("table", { name: "Keyspace" })).toContainText("db0");
  });
});

test.describe("pub/sub", () => {
  test("a subscription is only reported once Redis confirms it", async ({ page }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Pub/Sub" }).click();

    await page.getByLabel("Channels to subscribe to").fill("updates");
    await page.getByRole("button", { name: "Subscribe" }).click();

    await expect(page.getByText("Subscribed to updates")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("a published message arrives on the channel it was sent to", async ({
    page,
  }) => {
    const channel = uniqueChannel();
    await openRedis(page);
    await page.getByRole("button", { name: "Pub/Sub" }).click();
    await page.getByLabel("Channels to subscribe to").fill(channel);
    await page.getByRole("button", { name: "Subscribe" }).click();
    await expect(page.getByText(`Subscribed to ${channel}`)).toBeVisible({
      timeout: 15_000,
    });

    await page.getByLabel("Channel to publish to").fill(channel);
    await page.getByLabel("Message to publish").fill("hello there");
    await page.getByRole("button", { name: "Publish" }).click();

    const messages = page.getByRole("list", { name: "Messages" });
    await expect(messages).toContainText("hello there");
    await expect(messages).toContainText(channel);
    // the count is the useful part: it says somebody was listening
    await expect(page.getByText("Delivered to 1 subscriber")).toBeVisible();
  });

  test("a pattern subscription reports which pattern matched", async ({ page }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Pub/Sub" }).click();

    await page.getByLabel("Patterns to subscribe to").fill("events:*");
    await page.getByRole("button", { name: "Subscribe" }).click();
    await expect(page.getByText("Subscribed to events:*")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByLabel("Channel to publish to").fill("events:signup");
    await page.getByLabel("Message to publish").fill("user 7");
    await page.getByRole("button", { name: "Publish" }).click();

    const messages = page.getByRole("list", { name: "Messages" });
    await expect(messages).toContainText("events:signup");
    await expect(messages).toContainText("events:*");
  });

  test("publishing to a channel nobody listens to says so", async ({ page }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Pub/Sub" }).click();

    await page.getByLabel("Channel to publish to").fill(uniqueChannel());
    await page.getByLabel("Message to publish").fill("anyone there");
    await page.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByText(/Nobody is listening to that channel/)).toBeVisible();
  });

  test("a live subscription shows up in the channel list", async ({ page }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Pub/Sub" }).click();
    await page.getByLabel("Channels to subscribe to").fill("watched");
    await page.getByRole("button", { name: "Subscribe" }).click();
    await expect(page.getByText("Subscribed to watched")).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByLabel("Active channels")).toContainText("watched", {
      timeout: 10_000,
    });
  });
});

test.describe("a Redis connection is not a SQL one", () => {
  test("it is not offered tables or slow queries", async ({ page }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Actions for Cache" }).click();

    await expect(page.getByRole("menuitem", { name: "Slow queries" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Edit connection" })).toBeVisible();
  });

  test("Redis is one of the things you can connect to", async ({ page }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();
    await page.getByRole("button", { name: "Redis", exact: true }).click();

    await expect(page.getByLabel("Server address")).toHaveAttribute(
      "placeholder",
      /redis:\/\//
    );
    await expect(page.getByText(/database number/)).toBeVisible();
  });

  test("a URL that is not a Redis one is pointed out", async ({ page }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();
    await page.getByRole("button", { name: "Redis", exact: true }).click();
    await page.getByLabel("Server address").fill("postgresql://host/db");

    await expect(
      page.getByText(/A Redis address starts with redis:\/\//)
    ).toBeVisible();
  });
});

test.describe("the keyspace reads as a tree", () => {
  test("keys sharing a prefix are grouped under it", async ({ page }) => {
    await openRedis(page);

    // session:abc and session:def collapse into one branch
    const branch = page.getByRole("button", { name: /^session, \d+ keys$/ });
    await expect(branch).toBeVisible();
    await expect(keyRow(page, "abc")).toHaveCount(0);

    await branch.click();
    await expect(keyRow(page, "abc")).toBeVisible();
    await expect(keyRow(page, "def")).toBeVisible();
  });

  test("the flat view gives the whole key name back", async ({ page }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Grouped" }).click();

    await expect(page.getByRole("button", { name: "Flat" })).toBeVisible();
    await expect(keyRow(page, "session:abc")).toBeVisible();
    await expect(page.getByRole("button", { name: /^session, / })).toHaveCount(0);
  });

  test("a type filter narrows the list and says what it left out", async ({ page }) => {
    await openRedis(page);
    const total = (await page.getByRole("listitem").count()) > 0;
    expect(total).toBe(true);

    await page.getByRole("button", { name: /^Hash, \d+ keys$/ }).click();

    await expect(keyRow(page, "leaderboard")).toHaveCount(0);
    await expect(keyRow(page, "user:7")).toBeVisible();
    await expect(page.getByText(/keys? of \d+/)).toBeVisible();
  });

  test("a stream is not labelled the same as a string", async ({ page }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Grouped" }).click();

    // both start with "str", which is exactly the confusion the column creates
    await expect(keyRow(page, "events")).toContainText("strm");
    await expect(keyRow(page, "greeting")).toContainText("str");
    await expect(keyRow(page, "greeting")).not.toContainText("strm");
  });
});

test.describe("a value is shown as what it is", () => {
  test("a JSON string opens as a tree, and raw text is still there", async ({
    page,
  }) => {
    await openRedis(page);
    await page.getByRole("button", { name: /^session, / }).click();
    await keyRow(page, "abc").click();

    const value = page.getByLabel("Key value");
    await expect(value).toContainText("verified");
    // a tree, not one escaped line: the braces are gone from the rendered text
    await expect(value).not.toContainText('{"user"');

    await page.getByRole("button", { name: "Raw", exact: true }).click();
    await expect(page.getByLabel("Key value")).toContainText('{"user"');
  });

  test("a large hash can be filtered down to one field", async ({ page }) => {
    await openRedis(page);
    await keyRow(page, "metrics:daily").click();

    const rows = page.getByRole("table", { name: "Hash fields" }).locator("tbody tr");
    await expect(rows).toHaveCount(24);

    await page.getByLabel("Filter entries").fill("day-13");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("91");
  });

  test("a small hash is not given a filter it does not need", async ({ page }) => {
    await openRedis(page);
    await keyRow(page, "user:7").click();

    await expect(page.getByRole("table", { name: "Hash fields" })).toBeVisible();
    await expect(page.getByLabel("Filter entries")).toHaveCount(0);
  });

  test("a list keeps its real index while it is filtered", async ({ page }) => {
    await openRedis(page);
    await keyRow(page, "queue:jobs").click();

    const rows = page.getByRole("table", { name: "List members" }).locator("tbody tr");
    await expect(rows.last()).toContainText("third");
    await expect(rows.last()).toContainText("2");
  });
});

test.describe("channels other applications use", () => {
  test("one is listed with its subscriber count, and this tab is not counted in", async ({
    page,
    context,
  }) => {
    const channel = uniqueChannel();

    // a second tab standing in for another application on the same server
    const other = await context.newPage();
    await openRedis(other);
    await other.getByRole("button", { name: "Pub/Sub" }).click();
    await other.getByLabel("Channels to subscribe to").fill(channel);
    await other.getByRole("button", { name: "Subscribe" }).click();
    await expect(other.getByText(`Subscribed to ${channel}`)).toBeVisible({
      timeout: 15_000,
    });

    await openRedis(page);
    await page.getByRole("button", { name: "Pub/Sub" }).click();

    const row = page.getByRole("button", { name: `Listen to ${channel}` });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("1 app");
    await expect(row).not.toContainText("you");

    // one click is the whole subscribe step
    await row.click();
    await expect(page.getByText(`Subscribed to ${channel}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(row).toContainText("you");
    await expect(row).toContainText("1 app");

    await other.close();
  });

  test("the Pub/Sub tab carries the live channel count", async ({ page }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Pub/Sub" }).click();
    await page.getByLabel("Channels to subscribe to").fill(uniqueChannel());
    await page.getByRole("button", { name: "Subscribe" }).click();

    await expect(page.getByRole("button", { name: /Pub\/Sub \d+/ })).toBeVisible({
      timeout: 10_000,
    });
  });
});
