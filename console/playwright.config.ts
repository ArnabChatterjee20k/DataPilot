import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const CONSOLE_PORT = 5199;
const API_PORT = 8010;

/** Server state for the run, thrown away afterwards. */
const dataDir = path.join(process.cwd(), "e2e", ".tmp");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://127.0.0.1:${CONSOLE_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: `uv run uvicorn main:api --host 127.0.0.1 --port ${API_PORT}`,
      cwd: path.join(process.cwd(), "..", "server"),
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        MODE: "E2E",
        DB_PATH: path.join(dataDir, "config.db"),
        BUCKET_DIR: path.join(dataDir, "bucket"),
      },
    },
    {
      // vite binds to "localhost" (IPv6 only) by default; the tests dial 127.0.0.1
      command: `npx vite --host 127.0.0.1 --port ${CONSOLE_PORT} --strictPort`,
      port: CONSOLE_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_API_URL: `http://127.0.0.1:${API_PORT}`,
        // the floating devtools toggle sits over the app's own controls
        VITE_HIDE_DEVTOOLS: "1",
      },
    },
  ],
});

export { API_PORT, CONSOLE_PORT, dataDir };
