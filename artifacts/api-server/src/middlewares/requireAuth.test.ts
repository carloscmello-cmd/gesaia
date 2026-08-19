/**
 * Regression tests for the concurrent first-login user provisioning in requireAuth.
 *
 * The scenario being guarded: on a new consultant's very first login the browser
 * fires several authenticated requests in parallel (e.g. /me, /companies, /dashboard).
 * All of them enter requireAuth simultaneously, find no user row, and race to create
 * one. Without ON CONFLICT DO NOTHING, the second concurrent insert would throw a
 * unique-constraint violation (500). These tests confirm that provisionUser handles
 * the race gracefully and always returns a valid user row.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { continueWithEnabledAccount } from "./accountStatus.ts";
import { requireRole } from "./authorization.ts";
import {
  DEFAULT_PROVISIONED_ROLE,
  provisionUser,
  type UserRow,
  type UserProvisioner,
} from "./provisionUser.ts";

// ── Minimal fake row ──────────────────────────────────────────────────────────

function fakeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 1,
    clerkId: "clerk_test_abc",
    email: "consultant@example.com",
    name: "Test User",
    role: DEFAULT_PROVISIONED_ROLE,
    language: "pt",
    disabled: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("a freshly provisioned consultant is rejected by admin-only middleware", async () => {
  const provisioned = await provisionUser(
    {
      insertIfAbsent: async () => fakeUser(),
      findByClerkId: async () => undefined,
    },
    "clerk_new_consultant",
    "new.consultant@example.com",
    "New Consultant",
  );

  assert.equal(provisioned.role, "consultant");

  let statusCode: number | undefined;
  let body: unknown;
  let nextCalled = false;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  };

  requireRole("admin")(
    { dbUser: provisioned } as any,
    response as any,
    () => {
      nextCalled = true;
    },
  );

  assert.equal(statusCode, 403);
  assert.deepEqual(body, { error: "Forbidden" });
  assert.equal(nextCalled, false);
});

test("a valid authenticated request for a disabled database user receives 403", () => {
  const disabledUser = fakeUser({ disabled: true });
  const request = { clerkUserId: disabledUser.clerkId };
  let statusCode: number | undefined;
  let body: unknown;
  let routeHandlerCalled = false;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  };

  const allowed = continueWithEnabledAccount(request, disabledUser, response, () => {
    routeHandlerCalled = true;
  });

  assert.equal(allowed, false);
  assert.equal(statusCode, 403);
  assert.deepEqual(body, { error: "Account disabled" });
  assert.equal("dbUser" in request, false);
  assert.equal(routeHandlerCalled, false);
});

test("an active authenticated user continues to the downstream route handler", () => {
  const activeUser = fakeUser();
  const request: { clerkUserId: string; dbUser?: UserRow } = { clerkUserId: activeUser.clerkId };
  let routeHandlerCalled = false;
  const response = {
    status(code: number) {
      throw new Error(`Unexpected response status ${code}`);
    },
    json(value: unknown) {
      throw new Error(`Unexpected response body ${JSON.stringify(value)}`);
    },
  };

  const allowed = continueWithEnabledAccount(request, activeUser, response, () => {
    routeHandlerCalled = true;
    assert.equal(request.dbUser, activeUser);
  });

  assert.equal(allowed, true);
  assert.equal(routeHandlerCalled, true);
});

test("provisionUser returns the inserted row when there is no concurrent conflict", async () => {
  const row = fakeUser();
  let findCalled = false;

  const provisioner: UserProvisioner = {
    insertIfAbsent: async () => row,   // insert succeeds
    findByClerkId:  async () => { findCalled = true; return undefined; },
  };

  const result = await provisionUser(provisioner, "clerk_test_abc", "consultant@example.com", "Test User");

  assert.deepEqual(result, row, "Should return the freshly inserted row");
  assert.equal(findCalled, false, "Should not re-fetch when insert succeeds");
});

test("provisionUser falls back to re-fetch when another request won the insert race", async () => {
  // insertIfAbsent returns null  → ON CONFLICT DO NOTHING suppressed the insert
  const existingRow = fakeUser({ id: 2, name: "Concurrent User" });
  let findCalled = false;

  const provisioner: UserProvisioner = {
    insertIfAbsent: async () => null,          // conflict — no-op
    findByClerkId:  async () => { findCalled = true; return existingRow; },
  };

  const result = await provisionUser(provisioner, "clerk_test_abc", "consultant@example.com", "Concurrent User");

  assert.deepEqual(result, existingRow, "Should return the row committed by the concurrent request");
  assert.equal(findCalled, true, "Should re-fetch after a conflict no-op");
});

test("provisionUser throws if re-fetch returns nothing (unexpected DB state)", async () => {
  // Both the insert and the re-fetch return nothing — should never happen in
  // practice but must not silently return undefined.
  const provisioner: UserProvisioner = {
    insertIfAbsent: async () => null,
    findByClerkId:  async () => undefined,
  };

  await assert.rejects(
    () => provisionUser(provisioner, "clerk_test_abc", "consultant@example.com", "Test User"),
    /provisionUser: no row found for clerkId=/,
    "Should throw a descriptive error rather than returning undefined",
  );
});

test("provisionUser stores the provided email and name on first insert", async () => {
  let captured: { clerkId: string; email: string; name: string } | null = null;

  const provisioner: UserProvisioner = {
    insertIfAbsent: async (clerkId, email, name) => {
      captured = { clerkId, email, name };
      return fakeUser({ clerkId, email, name });
    },
    findByClerkId: async () => undefined,
  };

  await provisionUser(provisioner, "clerk_xyz", "new@example.com", "New Consultant");

  assert.ok(captured !== null, "insertIfAbsent should have been called");
  assert.equal(captured!.clerkId, "clerk_xyz");
  assert.equal(captured!.email,   "new@example.com");
  assert.equal(captured!.name,    "New Consultant");
});
