import { defineConfig } from "@playwright/test";

/**
 * This suite sends real emails and talks to Clerk, so keep it isolated from the
 * fast local test suite and run only one test worker at a time.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "invitation-revocation.spec.ts",
    "suspended-user-lockout.spec.ts",
    "report-export-idempotency.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  // Two invitation emails and an optional verification email can each take a
  // minute to arrive. Leave enough time for their cleanup too.
  timeout: 360_000,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
