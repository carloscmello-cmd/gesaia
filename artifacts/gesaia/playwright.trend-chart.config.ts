import { defineConfig } from "@playwright/test";

/**
 * This suite talks to the real authenticated app and database. Keep it
 * separate from the fast component/unit tests and run it against a dedicated
 * non-production Clerk tenant.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "trend-chart.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});