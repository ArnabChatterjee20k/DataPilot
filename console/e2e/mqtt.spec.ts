import { expect, test } from "./fixtures";

import {
  API_URL,
  deleteAllConnections,
  expandConnection,
  openPlayground,
} from "./helpers";
import { startBroker, BROKER_URL, type Broker } from "./upstream";

let broker: Broker;

test.beforeAll(async () => {
  broker = await startBroker();
});

test.afterAll(async () => {
  await broker.stop();
});

let connectionName: string;

test.beforeEach(async ({ request }) => {
  await deleteAllConnections(request);
  connectionName = `Broker ${Date.now()}`;

  const created = await request.post(`${API_URL}/connections`, {
    data: { source: "api", name: connectionName, connection_uri: BROKER_URL },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
});

async function openMqtt(page: import("@playwright/test").Page) {
  await openPlayground(page);
  await expandConnection(page, connectionName);
  await page.getByRole("button", { name: "MQTT", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByLabel("Broker state")).toContainText("open");
}

test.describe("the MQTT tab", () => {
  test("a broker connection offers MQTT instead of requests", async ({ page }) => {
    await openPlayground(page);
    await expandConnection(page, connectionName);

    await expect(page.getByRole("button", { name: "MQTT", exact: true })).toBeVisible();
    // a broker speaks neither HTTP nor websocket
    await expect(page.getByRole("button", { name: "New request" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "WebSocket" })).toHaveCount(0);
  });

  test("connecting says which broker, and under which client id", async ({ page }) => {
    await openMqtt(page);
    await expect(page.getByText(/Connected to mqtt:\/\/127\.0\.0\.1/)).toBeVisible();
    await expect(page.getByText(/as datapilot-/)).toBeVisible();
  });

  test("subscribing is only reported once the broker has agreed", async ({ page }) => {
    await openMqtt(page);

    await page.getByLabel("Topic").fill("sensors/+/temperature");
    await page.getByLabel("QoS").click();
    await page.getByRole("option", { name: "QoS 1" }).click();
    await page.getByRole("button", { name: "Subscribe" }).click();

    const chips = page.getByRole("group", { name: "Subscriptions" });
    await expect(chips).toContainText("sensors/+/temperature");
    await expect(chips).toContainText("Q1");
  });

  test("a message published to a subscribed topic comes back", async ({ page }) => {
    await openMqtt(page);

    await page.getByLabel("Topic").fill("sensors/+/temperature");
    await page.getByRole("button", { name: "Subscribe" }).click();
    await expect(page.getByRole("group", { name: "Subscriptions" })).toBeVisible();

    // publishing needs a concrete topic, so the wildcard is replaced
    await page.getByLabel("Topic").fill("sensors/1/temperature");
    await page.getByLabel("Payload to publish").fill("21.5");
    await page.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByText("sensors/1/temperature · QoS 0")).toHaveCount(2);
    await expect(page.getByText("21.5")).toBeVisible();
  });

  test("a retained publish says so", async ({ page }) => {
    await openMqtt(page);

    await page.getByLabel("Topic").fill("state/door");
    await page.getByLabel("Retain").click();
    await page.getByLabel("Payload to publish").fill("open");
    await page.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByText(/state\/door \(retained\)/)).toBeVisible();
  });

  test("unsubscribing removes the topic", async ({ page }) => {
    await openMqtt(page);

    await page.getByLabel("Topic").fill("chatter");
    await page.getByRole("button", { name: "Subscribe" }).click();
    const chips = page.getByRole("group", { name: "Subscriptions" });
    await expect(chips).toContainText("chatter");

    await page.getByRole("button", { name: "Unsubscribe from chatter" }).click();
    await expect(chips).toHaveCount(0);
  });

  test("a bad topic filter is explained without dropping the session", async ({
    page,
  }) => {
    await openMqtt(page);

    await page.getByLabel("Topic").fill("a/#/b");
    await page.getByRole("button", { name: "Subscribe" }).click();

    const banner = page.getByRole("status");
    await expect(banner).toContainText("The broker refused that");
    await expect(banner).toContainText("last level");
    // the session survives, so a typo does not cost a reconnect
    await expect(page.getByLabel("Broker state")).toContainText("open");

    await page.getByLabel("Topic").fill("a/b");
    await page.getByRole("button", { name: "Subscribe" }).click();
    await expect(page.getByRole("group", { name: "Subscriptions" })).toContainText("a/b");
  });

  test("publishing to a wildcard is explained", async ({ page }) => {
    await openMqtt(page);

    await page.getByLabel("Topic").fill("sensors/+/temperature");
    await page.getByLabel("Payload to publish").fill("x");
    await page.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByRole("status")).toContainText("belong in a subscription");
  });

  test("an unreachable broker reports why, before anything is subscribed", async ({
    page,
    request,
  }) => {
    await request.post(`${API_URL}/connections`, {
      data: { source: "api", name: "Dead broker", connection_uri: "mqtt://127.0.0.1:1" },
    });

    await openPlayground(page);
    await expandConnection(page, "Dead broker");
    await page.getByRole("button", { name: "MQTT", exact: true }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();

    const banner = page.getByRole("status");
    await expect(banner).toContainText("Could not connect", { timeout: 20_000 });
    await expect(banner).toContainText("refused");
    await expect(page.getByLabel("Broker state")).toContainText("closed");
  });

  test("a broker connection is dialled for real when it is tested", async ({
    page,
  }) => {
    await openPlayground(page);
    await expect(
      page.getByRole("button", { name: /^Reachable/ })
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("creating a broker connection", () => {
  test("MQTT is one of the things you can connect to", async ({ page }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();
    await page.getByRole("button", { name: "MQTT broker" }).click();

    await expect(page.getByLabel("Broker address")).toHaveAttribute(
      "placeholder",
      /mqtt:\/\//
    );
    // the credentials belong in variables, where they are masked
    await expect(page.getByText(/mqtt_username/)).toBeVisible();
  });

  test("a URL that does not match the kind is pointed out", async ({ page }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();
    await page.getByRole("button", { name: "MQTT broker" }).click();

    await page.getByLabel("Broker address").fill("https://api.example.com");
    await expect(page.getByText(/A broker address starts with mqtt/)).toBeVisible();

    await page.getByRole("button", { name: "HTTP / WebSocket" }).click();
    await page.getByLabel("Base URL").fill("mqtt://broker.example.com");
    await expect(page.getByText(/choose MQTT broker instead/)).toBeVisible();
  });

  test("a broker created through the dialog works end to end", async ({ page }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: "New connection" }).click();
    await page.getByRole("button", { name: "MQTT broker" }).click();

    await page.getByLabel("Name").fill("Dialog broker");
    await page.getByLabel("Broker address").fill(BROKER_URL);
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText(/Connected to mqtt/)).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Create connection" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expandConnection(page, "Dialog broker");
    await page.getByRole("button", { name: "MQTT", exact: true }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByLabel("Broker state")).toContainText("open");
  });

  test("editing a broker connection comes back as MQTT", async ({ page }) => {
    await openPlayground(page);
    await page.getByRole("button", { name: `Actions for ${connectionName}` }).click();
    await page.getByRole("menuitem", { name: "Edit connection" }).click();

    await expect(page.getByLabel("Broker address")).toHaveValue(BROKER_URL);
  });
});
