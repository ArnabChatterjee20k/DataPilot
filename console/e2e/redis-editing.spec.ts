import { expect, test, type Page } from "./fixtures";

import { API_URL, deleteAllConnections, expandConnection, openPlayground } from "./helpers";
import { seedRedis } from "./redisSeed";

/**
 * Changing what is in Redis, from the browser.
 *
 * Every write here uses a key the test made itself. The seeded keys are what
 * the reading tests assert on, and a test that edited `greeting` would pass
 * alone and break the next one.
 */
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
  // read-only, which is the default, so every write has to ask
  await request.post(`${API_URL}/connections`, {
    data: { source: "redis", name: "Cache", connection_uri: REDIS_URL },
  });
});

const unique = (prefix: string) =>
  `e2e:${prefix}:${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function openRedis(page: Page) {
  await openPlayground(page);
  await expandConnection(page, "Cache");
  await page.getByRole("button", { name: "Browse" }).click();
}

async function allowWrites(page: Page) {
  await page.getByText("Allow writes", { exact: true }).click();
}

/** Create a key through the dialog, the way someone would. */
async function createKey(
  page: Page,
  key: string,
  type: string,
  fill: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>
) {
  await page.getByRole("button", { name: "New key" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Key name").fill(key);
  await dialog.getByLabel("Key type").click();
  await page.getByRole("option", { name: type, exact: true }).click();
  await fill(dialog);
  await dialog.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("redis-key-name")).toHaveText(key);
}

test.describe("a read-only connection", () => {
  test("offers the controls but will not use them until writes are allowed", async ({
    page,
  }) => {
    await openRedis(page);
    await page.getByRole("listitem").filter({ hasText: "greeting" }).first().click();

    // the controls are there, disabled, so it reads as "not allowed here"
    // rather than "cannot be edited"
    await expect(page.getByRole("button", { name: "New key" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Delete key" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();

    await allowWrites(page);

    await expect(page.getByRole("button", { name: "New key" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
  });
});

test.describe("creating and editing keys", () => {
  test("a hash is created, then a field is added, edited and removed", async ({
    page,
  }) => {
    const key = unique("hash");
    await openRedis(page);
    await allowWrites(page);

    await createKey(page, key, "Hash", async (dialog) => {
      await dialog.getByPlaceholder("field").first().fill("name");
      await dialog.getByPlaceholder("value").first().fill("Ada");
    });

    const fields = page.getByRole("table", { name: "Hash fields" });
    await expect(fields).toContainText("Ada");

    const add = page.getByRole("form", { name: "Add field" });
    await add.getByPlaceholder("field").fill("plan");
    await add.getByPlaceholder("value").fill("pro");
    await add.getByRole("button", { name: "Add field" }).click();
    await expect(fields).toContainText("plan");

    await page.getByRole("button", { name: "Edit value of name" }).click();
    await page.getByLabel("Value of name", { exact: true }).fill("Grace");
    await page.keyboard.press("Enter");
    await expect(fields).toContainText("Grace");
    await expect(fields).not.toContainText("Ada");

    await page.getByRole("button", { name: "Remove field plan" }).click();
    await expect(fields).not.toContainText("plan");
  });

  test("removing a list item takes that position, not every match", async ({
    page,
  }) => {
    const key = unique("list");
    await openRedis(page);
    await allowWrites(page);

    await createKey(page, key, "List", async (dialog) => {
      await dialog.getByLabel("Members").fill("x\ny\nx");
    });

    const members = page.getByRole("table", { name: "List members" });
    await page.getByRole("button", { name: "Remove item 2" }).click();

    // LREM would have taken both x's; the one pointed at is the one that goes
    await expect(members.locator("tbody tr")).toHaveCount(2);
    await expect(members).toContainText("x");
    await expect(members).toContainText("y");

    await page.getByLabel("New item").fill("first");
    await page.getByRole("button", { name: "Push to front" }).click();
    await expect(members.locator("tbody tr").first()).toContainText("first");
  });

  test("a string is edited, and given and relieved of an expiry", async ({ page }) => {
    const key = unique("string");
    await openRedis(page);
    await allowWrites(page);

    await createKey(page, key, "String", async (dialog) => {
      await dialog.getByLabel("Key value").fill("hello");
    });

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Edit value", { exact: true }).fill("hello again");
    await page.getByRole("button", { name: "Save value" }).click();
    await expect(page.getByLabel("Key value")).toHaveText("hello again");

    await page.getByRole("button", { name: "Change expiry" }).click();
    await page.getByLabel("Expires in seconds", { exact: true }).fill("120");
    await page.keyboard.press("Enter");
    await expect(page.getByText("2m left")).toBeVisible();

    await page.getByRole("button", { name: "Change expiry" }).click();
    await page.getByRole("button", { name: "Never expire" }).click();
    await expect(page.getByText("no expiry")).toBeVisible();
  });

  test("an existing key is not overwritten by accident", async ({ page }) => {
    await openRedis(page);
    await allowWrites(page);

    await page.getByRole("button", { name: "New key" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Key name").fill("greeting");
    await dialog.getByLabel("Key value").fill("clobbered");
    await dialog.getByRole("button", { name: "Create key" }).click();

    await expect(dialog.getByRole("alert")).toContainText("already a key");
    // the dialog stays open with what was typed, rather than losing it
    await expect(dialog.getByLabel("Key value")).toHaveValue("clobbered");
  });

  test("a key is renamed", async ({ page }) => {
    const key = unique("rename");
    await openRedis(page);
    await allowWrites(page);
    await createKey(page, key, "String", async (dialog) => {
      await dialog.getByLabel("Key value").fill("x");
    });

    await page.getByRole("button", { name: "Edit key name" }).click();
    await page.getByLabel("Key name", { exact: true }).fill(`${key}:renamed`);
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("redis-key-name")).toHaveText(`${key}:renamed`);
  });

  test("the key list can be dragged wider, and stays that way", async ({ page }) => {
    await openRedis(page);
    const list = page.getByRole("list", { name: "Keys" });
    const before = (await list.boundingBox())!;

    const handle = page.locator('[role="separator"]').nth(1);
    const grip = (await handle.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 200, grip.y + grip.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = (await list.boundingBox())!;
    expect(after.width).toBeGreaterThan(before.width + 100);

    // the layout is saved a moment after the drag ends, not during it
    await expect
      .poll(() =>
        page.evaluate(
          () => localStorage.getItem("react-resizable-panels:datapilot.redis-keys") ?? ""
        )
      )
      .not.toContain("[28,72]");

    // the tab is remembered, so the key list comes straight back
    await page.reload();
    const reopened = page.getByRole("list", { name: "Keys" });
    await expect(reopened).toBeVisible();
    await expect
      .poll(async () => Math.abs((await reopened.boundingBox())!.width - after.width))
      .toBeLessThan(30);
  });
});

test.describe("the command runner", () => {
  async function command(page: Page, text: string) {
    const input = page.getByLabel("Redis command");
    await input.fill(text);
    await input.press("Enter");
  }

  test("a reply reads the way redis-cli prints it", async ({ page }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Command", exact: true }).click();

    await command(page, "GET greeting");
    await command(page, "GET ghost");
    await command(page, "LRANGE queue:jobs 0 -1");

    const output = page.getByLabel("Command output");
    await expect(output).toContainText('"hello"');
    await expect(output).toContainText("(nil)");
    await expect(output).toContainText("1)");
  });

  test("a write is refused on a read-only connection until writes are allowed", async ({
    page,
  }) => {
    const key = unique("cmd");
    await openRedis(page);
    await page.getByRole("button", { name: "Command", exact: true }).click();

    await command(page, `SET ${key} yes`);
    await expect(page.getByLabel("Command output")).toContainText("read-only");

    await allowWrites(page);
    await command(page, `SET ${key} yes`);
    await command(page, `GET ${key}`);
    await expect(page.getByLabel("Command output")).toContainText('"yes"');
  });

  test("emptying the database asks first, and cancelling keeps every key", async ({
    page,
  }) => {
    await openRedis(page);
    await allowWrites(page);
    await page.getByRole("button", { name: "Command", exact: true }).click();

    await command(page, "FLUSHDB");
    await expect(page.getByRole("alert")).toContainText("cannot be undone");
    await page.getByRole("button", { name: "Cancel" }).click();

    await command(page, "EXISTS greeting");
    await expect(page.getByLabel("Command output")).toContainText("(integer) 1");
  });

  test("a command that would hold the connection open is pointed elsewhere", async ({
    page,
  }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Command", exact: true }).click();

    await command(page, "SUBSCRIBE news");

    await expect(page.getByLabel("Command output")).toContainText("Pub/Sub panel");
  });

  test("up arrow brings back the last command", async ({ page }) => {
    await openRedis(page);
    await page.getByRole("button", { name: "Command", exact: true }).click();
    await command(page, "PING");

    await page.getByLabel("Redis command").press("ArrowUp");

    await expect(page.getByLabel("Redis command")).toHaveValue("PING");
  });
});
