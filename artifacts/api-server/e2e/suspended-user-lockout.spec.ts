import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type ClerkUser = {
  id: string;
};

type ClerkSignInToken = {
  url: string;
};

type E2eConfig = {
  adminUserId: string;
  appUrl: string;
  clerkSecretKey: string;
};

type BrowserApiResponse = {
  body: string;
  status: number;
};

type AppUser = {
  clerkId: string;
  disabled: boolean;
  id: number;
};

const CLERK_API_URL = "https://api.clerk.com";
const ME_PATH = "/api/users/me";
const USERS_PATH = "/api/users";
const PRODUCTION_ENVIRONMENT_VARIABLES = [
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
] as const;

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. See docs/invitation-revocation-browser-test.md for the isolated E2E configuration.`,
    );
  }
  return value;
}

function loadConfig(): E2eConfig {
  if (requireEnvironment("INVITATION_E2E_ENVIRONMENT") !== "non-production") {
    throw new Error(
      "INVITATION_E2E_ENVIRONMENT must be non-production; this suite only runs against the isolated test environment.",
    );
  }

  const productionEnvironmentVariable = PRODUCTION_ENVIRONMENT_VARIABLES.find((name) =>
    process.env[name]?.trim(),
  );
  if (productionEnvironmentVariable) {
    throw new Error(
      `${productionEnvironmentVariable} must not be available to the invitation E2E job; use only the dedicated non-production Clerk secret.`,
    );
  }

  const appUrl = new URL(requireEnvironment("INVITATION_E2E_APP_URL"));
  if (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") {
    throw new Error("INVITATION_E2E_APP_URL must use http or https.");
  }

  const clerkSecretKey = requireEnvironment("INVITATION_E2E_CLERK_SECRET_KEY");
  if (!clerkSecretKey.startsWith("sk_test_")) {
    throw new Error(
      "INVITATION_E2E_CLERK_SECRET_KEY must be an sk_test_ key from the dedicated non-production Clerk tenant.",
    );
  }

  return {
    appUrl: appUrl.toString(),
    clerkSecretKey,
    adminUserId: requireEnvironment("INVITATION_E2E_ADMIN_USER_ID"),
  };
}

async function clerkRequest<T>(
  config: E2eConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${CLERK_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.clerkSecretKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Clerk request ${init.method ?? "GET"} ${path} failed with ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

async function clerkDeleteUser(config: E2eConfig, userId: string): Promise<void> {
  const response = await fetch(`${CLERK_API_URL}/v1/users/${userId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${config.clerkSecretKey}` },
  });

  if (response.status !== 404 && !response.ok) {
    throw new Error(`Clerk cleanup DELETE /v1/users/${userId} failed with ${response.status}.`);
  }
}

function appPath(config: E2eConfig, path: string): string {
  return new URL(path, config.appUrl).toString();
}

async function appRequest(
  page: Page,
  config: E2eConfig,
  path: string,
  init: { method: string; body?: unknown },
): Promise<BrowserApiResponse> {
  return page.evaluate(
    async ({ url, request }) => {
      const response = await fetch(url, {
        method: request.method,
        credentials: "include",
        headers: request.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      return { body: await response.text(), status: response.status };
    },
    { url: appPath(config, path), request: init },
  );
}

async function createAuthenticatedSession(
  page: Page,
  config: E2eConfig,
  userId: string,
): Promise<void> {
  const signInToken = await clerkRequest<ClerkSignInToken>(config, "/v1/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({
      expires_in_seconds: 120,
      user_id: userId,
    }),
  });

  await page.goto(signInToken.url);
  await page.goto(config.appUrl);
}

async function createDisposableClerkUser(config: E2eConfig): Promise<ClerkUser> {
  const runId = randomUUID().replace(/-/g, "");
  return clerkRequest<ClerkUser>(config, "/v1/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [`suspended-${runId}@example.com`],
      first_name: "Suspended",
      last_name: "Regression",
      password: `Suspended!${runId}`,
      skip_password_checks: true,
    }),
  });
}

async function findAppUser(
  page: Page,
  config: E2eConfig,
  clerkId: string,
): Promise<AppUser> {
  const response = await appRequest(page, config, USERS_PATH, { method: "GET" });
  expect(response.status).toBe(200);

  const users = JSON.parse(response.body) as AppUser[];
  const user = users.find((candidate) => candidate.clerkId === clerkId);
  if (!user) {
    throw new Error(`The app did not provision a database row for Clerk user ${clerkId}.`);
  }
  return user;
}

test("a disabled database user is blocked after Clerk creates a fresh session", async ({ browser }) => {
  const config = loadConfig();
  const contexts: BrowserContext[] = [];
  let adminPage: Page | undefined;
  let clerkUser: ClerkUser | undefined;
  let appUser: AppUser | undefined;
  let primaryFailure: unknown;

  try {
    const adminContext = await browser.newContext();
    contexts.push(adminContext);
    adminPage = await adminContext.newPage();
    await createAuthenticatedSession(adminPage, config, config.adminUserId);

    clerkUser = await createDisposableClerkUser(config);

    const initialUserContext = await browser.newContext();
    contexts.push(initialUserContext);
    const initialUserPage = await initialUserContext.newPage();
    await createAuthenticatedSession(initialUserPage, config, clerkUser.id);
    await expect.poll(
      async () => (await appRequest(initialUserPage, config, ME_PATH, { method: "GET" })).status,
      { message: "The disposable Clerk user should be provisioned in the application database." },
    ).toBe(200);

    appUser = await findAppUser(adminPage, config, clerkUser.id);
    const disableResponse = await appRequest(adminPage, config, `${USERS_PATH}/${appUser.id}`, {
      method: "DELETE",
    });
    expect(disableResponse.status).toBe(204);
    expect(disableResponse.body).toBe("");

    const suspendedUserContext = await browser.newContext();
    contexts.push(suspendedUserContext);
    const suspendedUserPage = await suspendedUserContext.newPage();
    await createAuthenticatedSession(suspendedUserPage, config, clerkUser.id);

    await expect.poll(
      async () => (await appRequest(suspendedUserPage, config, ME_PATH, { method: "GET" })).status,
      { message: "A Clerk-authenticated suspended user should reach the app and receive the database lockout." },
    ).toBe(403);

    const protectedResponse = await appRequest(suspendedUserPage, config, ME_PATH, { method: "GET" });
    expect(protectedResponse.status).toBe(403);
    expect(JSON.parse(protectedResponse.body)).toEqual({ error: "Account disabled" });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanupFailures: string[] = [];

    if (appUser && adminPage) {
      try {
        const restoreResponse = await appRequest(adminPage, config, `${USERS_PATH}/${appUser.id}`, {
          method: "PATCH",
          body: { disabled: false },
        });
        if (restoreResponse.status !== 200) {
          cleanupFailures.push(`database user restore returned ${restoreResponse.status}: ${restoreResponse.body}`);
        }
      } catch (error) {
        cleanupFailures.push(`database user restore: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (clerkUser) {
      try {
        await clerkDeleteUser(config, clerkUser.id);
      } catch (error) {
        cleanupFailures.push(`Clerk user ${clerkUser.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await Promise.all(contexts.map(async (context) => context.close()));

    if (!primaryFailure && cleanupFailures.length) {
      throw new Error(`Suspended-user E2E cleanup failed:\n${cleanupFailures.join("\n")}`);
    }
  }
});