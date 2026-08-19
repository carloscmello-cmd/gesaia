import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import MailosaurClient from "mailosaur";

type InvitationResponse = {
  id: string;
  email: string;
};

type ClerkSignInToken = {
  url: string;
};

type ClerkUserList = {
  data?: Array<{ id: string }>;
};

type BrowserApiResponse = {
  body: string;
  status: number;
};

type E2eConfig = {
  adminUserId: string;
  appUrl: string;
  clerkSecretKey: string;
  mailosaurApiKey: string;
  mailosaurServerId: string;
};

const INVITATIONS_PATH = "/api/users/invitations";
const INVITE_PATH = "/api/users/invite";
const ME_PATH = "/api/users/me";
const CLERK_API_URL = "https://api.clerk.com";
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
    mailosaurApiKey: requireEnvironment("MAILOSAUR_API_KEY"),
    mailosaurServerId: requireEnvironment("MAILOSAUR_SERVER_ID"),
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

async function clerkRequestAllowingNotFound(
  config: E2eConfig,
  path: string,
  init: RequestInit,
): Promise<boolean> {
  const response = await fetch(`${CLERK_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.clerkSecretKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Clerk cleanup ${init.method ?? "GET"} ${path} failed with ${response.status}.`);
  }
  return true;
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

async function createAdminSession(page: Page, config: E2eConfig): Promise<void> {
  const signInToken = await clerkRequest<ClerkSignInToken>(config, "/v1/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({
      expires_in_seconds: 120,
      user_id: config.adminUserId,
    }),
  });

  await page.goto(signInToken.url);
  await page.goto(config.appUrl);

  await expect.poll(
    async () => (await appRequest(page, config, ME_PATH, { method: "GET" })).status,
    { message: "The dedicated Clerk admin should have an authenticated app session." },
  ).toBe(200);
}

async function inviteDisposableMailbox(
  page: Page,
  config: E2eConfig,
  mailbox: string,
): Promise<InvitationResponse> {
  const response = await appRequest(page, config, INVITE_PATH, {
    method: "POST",
    body: { email: mailbox },
  });
  expect(response.status).toBe(201);

  const invitation = JSON.parse(response.body) as InvitationResponse;
  expect(invitation).toMatchObject({ email: mailbox, id: expect.any(String) });
  return invitation;
}

function invitationLinkFromMessage(message: {
  html?: { body?: string; links?: Array<{ href?: string }> };
  text?: { body?: string; links?: Array<{ href?: string }> };
}): string {
  const links = [...(message.html?.links ?? []), ...(message.text?.links ?? [])]
    .map((link) => link.href)
    .filter((href): href is string => Boolean(href));

  const invitationLink = links.find((href) => {
    try {
      return new URL(href).searchParams.has("__clerk_ticket");
    } catch {
      return false;
    }
  });
  if (!invitationLink) {
    throw new Error("The invitation email did not contain a Clerk sign-up URL.");
  }
  return invitationLink;
}

function verificationCodeFromMessage(message: {
  html?: { codes?: Array<{ value?: string }> };
  text?: { codes?: Array<{ value?: string }> };
}): string {
  const code = [...(message.html?.codes ?? []), ...(message.text?.codes ?? [])]
    .map((item) => item.value)
    .find((value): value is string => Boolean(value));
  if (!code) {
    throw new Error("Clerk requested email verification, but the disposable mailbox had no verification code.");
  }
  return code;
}

async function getInvitationLink(
  mailosaur: MailosaurClient,
  config: E2eConfig,
  mailbox: string,
  receivedAfter: Date,
): Promise<string> {
  const message = await mailosaur.messages.get(
    config.mailosaurServerId,
    { sentTo: mailbox },
    { receivedAfter, timeout: 60_000 },
  );
  return invitationLinkFromMessage(message);
}

async function revokeThroughApplication(page: Page, config: E2eConfig, invitationId: string) {
  return appRequest(page, config, `${INVITATIONS_PATH}/${invitationId}`, { method: "DELETE" });
}

async function assertNoApplicationSession(page: Page, config: E2eConfig): Promise<void> {
  await page.goto(config.appUrl);
  const me = await appRequest(page, config, ME_PATH, { method: "GET" });
  expect(me.status).toBe(401);
}

async function acceptInvitation(
  page: Page,
  mailosaur: MailosaurClient,
  config: E2eConfig,
  invitationUrl: string,
  mailbox: string,
): Promise<void> {
  const acceptedAt = new Date();
  const password = `Invitation!${randomUUID().replace(/-/g, "")}`;

  await page.goto(invitationUrl);
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await page.locator('input[name="password"]').fill(password);

  const firstName = page.locator('input[name="firstName"]');
  if (await firstName.count()) await firstName.fill("Invitation");
  const lastName = page.locator('input[name="lastName"]');
  if (await lastName.count()) await lastName.fill("Regression");

  await page.getByRole("button", { name: /continue|sign up|create account/i }).click();

  const verificationCode = page.locator('input[name="code"]');
  if (await verificationCode.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const verificationMessage = await mailosaur.messages.get(
      config.mailosaurServerId,
      { sentTo: mailbox },
      { receivedAfter: acceptedAt, timeout: 60_000 },
    );
    await verificationCode.fill(verificationCodeFromMessage(verificationMessage));
    await page.getByRole("button", { name: /continue|verify/i }).click();
  }
}

async function deleteClerkUserByEmail(config: E2eConfig, email: string): Promise<void> {
  const users = await clerkRequest<ClerkUserList>(
    config,
    `/v1/users?email_address=${encodeURIComponent(email)}`,
  );
  for (const user of users.data ?? []) {
    await clerkRequestAllowingNotFound(config, `/v1/users/${user.id}`, { method: "DELETE" });
  }
}

async function closeContexts(contexts: BrowserContext[]): Promise<void> {
  await Promise.all(contexts.map(async (context) => context.close()));
}

async function deleteMailboxMessages(
  mailosaur: MailosaurClient,
  config: E2eConfig,
  mailbox: string,
): Promise<string[]> {
  const cleanupFailures: string[] = [];

  // Always re-query the mailbox rather than relying on IDs collected while
  // parsing email. That also removes messages received just before a test
  // failure or a parsing error.
  while (true) {
    const messages = await mailosaur.messages.search(
      config.mailosaurServerId,
      { sentTo: mailbox },
      { itemsPerPage: 100 },
    );
    const messageIds = (messages.items ?? [])
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id));
    if (!messageIds.length) return cleanupFailures;

    let deletedCount = 0;
    for (const messageId of messageIds) {
      try {
        await mailosaur.messages.del(messageId);
        deletedCount += 1;
      } catch (error) {
        cleanupFailures.push(
          `mailbox message ${messageId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Avoid an infinite retry loop when Mailosaur rejects every delete.
    if (!deletedCount) return cleanupFailures;
  }
}

test("a revoked Clerk invitation cannot create a session and an accepted invitation returns 404", async ({
  browser,
}) => {
  const config = loadConfig();
  const mailosaur = new MailosaurClient(config.mailosaurApiKey);
  const runId = randomUUID();
  const revokedMailbox = `revoked-${runId}@${config.mailosaurServerId}.mailosaur.net`;
  const acceptedMailbox = `accepted-${runId}@${config.mailosaurServerId}.mailosaur.net`;
  const contexts: BrowserContext[] = [];
  const invitationIds = new Set<string>();
  let primaryFailure: unknown;

  try {
    const adminContext = await browser.newContext();
    contexts.push(adminContext);
    const adminPage = await adminContext.newPage();
    await createAdminSession(adminPage, config);

    const revokedInvitationSentAt = new Date();
    const revokedInvitation = await inviteDisposableMailbox(adminPage, config, revokedMailbox);
    invitationIds.add(revokedInvitation.id);
    const revokedInvitationUrl = await getInvitationLink(
      mailosaur,
      config,
      revokedMailbox,
      revokedInvitationSentAt,
    );

    const initialInvitationContext = await browser.newContext();
    contexts.push(initialInvitationContext);
    const initialInvitationPage = await initialInvitationContext.newPage();
    await initialInvitationPage.goto(revokedInvitationUrl);
    await expect(initialInvitationPage.locator('input[name="password"]')).toBeVisible();

    const revokeResponse = await revokeThroughApplication(adminPage, config, revokedInvitation.id);
    expect(revokeResponse.status).toBe(204);
    expect(revokeResponse.body).toBe("");

    const revokedLinkContext = await browser.newContext();
    contexts.push(revokedLinkContext);
    const revokedLinkPage = await revokedLinkContext.newPage();
    await revokedLinkPage.goto(revokedInvitationUrl);
    await expect(revokedLinkPage.locator('input[name="password"]')).toHaveCount(0);
    await expect(revokedLinkPage.locator("body")).toContainText(/invalid|expired|revoked|no longer valid/i);
    await assertNoApplicationSession(revokedLinkPage, config);

    const acceptedInvitationSentAt = new Date();
    const acceptedInvitation = await inviteDisposableMailbox(adminPage, config, acceptedMailbox);
    invitationIds.add(acceptedInvitation.id);
    const acceptedInvitationUrl = await getInvitationLink(
      mailosaur,
      config,
      acceptedMailbox,
      acceptedInvitationSentAt,
    );

    const acceptedInvitationContext = await browser.newContext();
    contexts.push(acceptedInvitationContext);
    const acceptedInvitationPage = await acceptedInvitationContext.newPage();
    await acceptInvitation(
      acceptedInvitationPage,
      mailosaur,
      config,
      acceptedInvitationUrl,
      acceptedMailbox,
    );
    await acceptedInvitationPage.goto(config.appUrl);
    await expect.poll(
      async () => (await appRequest(acceptedInvitationPage, config, ME_PATH, { method: "GET" })).status,
      { message: "The accepted invitation should create a new Clerk application session." },
    ).toBe(200);

    const acceptedRevokeResponse = await revokeThroughApplication(adminPage, config, acceptedInvitation.id);
    expect(acceptedRevokeResponse.status).toBe(404);
    expect(JSON.parse(acceptedRevokeResponse.body)).toEqual({ error: "Invitation not found" });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanupFailures: string[] = [];

    for (const invitationId of invitationIds) {
      try {
        await clerkRequestAllowingNotFound(config, `/v1/invitations/${invitationId}`, { method: "DELETE" });
      } catch (error) {
        cleanupFailures.push(`invitation ${invitationId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const mailbox of [revokedMailbox, acceptedMailbox]) {
      try {
        await deleteClerkUserByEmail(config, mailbox);
      } catch (error) {
        cleanupFailures.push(`user ${mailbox}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const mailbox of [revokedMailbox, acceptedMailbox]) {
      try {
        cleanupFailures.push(...await deleteMailboxMessages(mailosaur, config, mailbox));
      } catch (error) {
        cleanupFailures.push(`mailbox ${mailbox}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await closeContexts(contexts);

    if (!primaryFailure && cleanupFailures.length) {
      throw new Error(`Invitation E2E cleanup failed:\n${cleanupFailures.join("\n")}`);
    }
  }
});