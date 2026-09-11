import { expect, test, type Page } from "./fixtures";

import { deleteAllConnections, openPlayground } from "./helpers";

/**
 * The form has to stay usable as kinds are added to it.
 *
 * A dialog does not scroll on its own, so every new field pushes the footer
 * further down until Create is off the bottom of the window with no way to
 * reach it. That is a failure nobody reports as a bug; they just cannot finish.
 */

test.beforeEach(async ({ request }) => {
  await deleteAllConnections(request);
});

async function openForm(page: Page, kind: string) {
  await openPlayground(page);
  await page.getByRole("button", { name: "Add a connection" }).first().click();
  await page.getByRole("button", { name: kind, exact: true }).click();
}

async function belowTheFold(page: Page, name: string) {
  const box = await page.getByRole("button", { name }).boundingBox();
  const viewport = page.viewportSize()!;
  return box ? box.y + box.height > viewport.height : true;
}

const KINDS = [
  "PostgreSQL",
  "MySQL",
  "SQLite file",
  "Redis",
  "HTTP / WebSocket",
  "MQTT broker",
  "Appwrite MQTT",
];

test.describe("the form stays reachable", () => {
  for (const kind of KINDS) {
    test(`${kind} keeps Create on screen`, async ({ page }) => {
      await openForm(page, kind);

      await expect(page.getByRole("button", { name: "Create connection" })).toBeVisible();
      expect(await belowTheFold(page, "Create connection")).toBe(false);
      expect(await belowTheFold(page, "Cancel")).toBe(false);

      // and the title is still readable at the top
      await expect(page.getByRole("heading", { name: "New connection" })).toBeVisible();
    });
  }

  test("the tallest Appwrite mode still fits, and Create can be clicked", async ({
    page,
  }) => {
    await openForm(page, "Appwrite MQTT");
    await page.getByRole("button", { name: "Mint from API key" }).click();

    const viewport = page.viewportSize()!;
    const dialog = await page.getByRole("dialog").boundingBox();
    expect(dialog!.height).toBeLessThanOrEqual(viewport.height);

    await page.getByLabel("Broker address").fill("mqtt://appwrite-mqtt:1883");
    await page.getByLabel("Project ID").fill("my-project");
    await page.getByRole("button", { name: "Paste credential" }).click();
    await page.getByPlaceholder("a current session secret").fill("a-secret");

    // clicking is the real test: a button can be visible and still unreachable
    await page.getByRole("button", { name: "Create connection" }).click({ timeout: 5_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("the Appwrite preset asks for what the broker needs", () => {
  test("Create waits for the project and the credential, and says which", async ({
    page,
  }) => {
    await openForm(page, "Appwrite MQTT");
    await page.getByLabel("Broker address").fill("mqtt://appwrite-mqtt:1883");

    const create = page.getByRole("button", { name: "Create connection" });
    await expect(create).toBeDisabled();
    await expect(create).toHaveAttribute("title", /Project ID is still needed/);

    await page.getByLabel("Project ID").fill("my-project");
    await expect(create).toBeDisabled();
    await expect(create).toHaveAttribute("title", /session secret or JWT is still needed/);

    await page.getByPlaceholder("a current session secret").fill("a-secret");
    await expect(create).toBeEnabled();
  });

  test("minting mode asks for a minted JWT rather than a pasted one", async ({
    page,
  }) => {
    await openForm(page, "Appwrite MQTT");
    await page.getByLabel("Broker address").fill("mqtt://appwrite-mqtt:1883");
    await page.getByLabel("Project ID").fill("my-project");
    await page.getByRole("button", { name: "Mint from API key" }).click();

    const create = page.getByRole("button", { name: "Create connection" });
    await expect(create).toBeDisabled();
    await expect(create).toHaveAttribute("title", /minted JWT is still needed/);
  });

  test("Test connection is held back by the same requirement", async ({ page }) => {
    await openForm(page, "Appwrite MQTT");
    await page.getByLabel("Broker address").fill("mqtt://appwrite-mqtt:1883");

    await expect(page.getByRole("button", { name: /Test connection/ })).toBeDisabled();
  });

  test("a broker address is still required", async ({ page }) => {
    await openForm(page, "Appwrite MQTT");
    await page.getByLabel("Project ID").fill("my-project");
    await page.getByPlaceholder("a current session secret").fill("a-secret");

    await expect(page.getByRole("button", { name: "Create connection" })).toBeDisabled();
  });

  test("a URL that is not a broker address is pointed out", async ({ page }) => {
    await openForm(page, "Appwrite MQTT");
    await page.getByLabel("Broker address").fill("https://cloud.appwrite.io");

    await expect(page.getByText(/A broker address starts with mqtt/)).toBeVisible();
  });
});
