/**
 * provisionUser — idempotent, race-safe first-login user creation.
 *
 * Extracted as a dependency-free module so it can be unit-tested without
 * pulling in Drizzle ORM, @workspace/db, or Clerk.
 *
 * The concrete DB adapter is built in requireAuth.ts using Drizzle primitives;
 * tests supply a lightweight mock instead.
 */

export type UserRow = {
  id: number;
  clerkId: string;
  email: string;
  name: string;
  role: "admin" | "consultant" | "manager" | "viewer";
  language: "pt" | "en";
  disabled: boolean;
  createdAt: Date;
};

/** Role assigned to users created during their first authenticated request. */
export const DEFAULT_PROVISIONED_ROLE = "consultant" as const;

/**
 * Minimal interface the caller must satisfy.
 *
 * - `insertIfAbsent` must run INSERT … ON CONFLICT DO NOTHING and return the
 *   inserted row, or null when the row already existed (conflict suppressed).
 * - `findByClerkId` re-fetches the row committed by a concurrent request.
 */
export interface UserProvisioner {
  insertIfAbsent(clerkId: string, email: string, name: string): Promise<UserRow | null>;
  findByClerkId(clerkId: string): Promise<UserRow | undefined>;
}

/**
 * Idempotent first-login provisioning, safe under concurrent requests.
 *
 * When two requests race to create the same user, only one INSERT wins.
 * The loser receives null from insertIfAbsent (ON CONFLICT DO NOTHING) and
 * re-fetches the row committed by the winner — no 500, no duplicate row.
 */
export async function provisionUser(
  provisioner: UserProvisioner,
  clerkId: string,
  email: string,
  name: string,
): Promise<UserRow> {
  const inserted = await provisioner.insertIfAbsent(clerkId, email, name);

  if (inserted !== null) {
    return inserted;
  }

  // Race condition: another in-flight request won the INSERT first.
  // Re-fetch the row that was committed by that other request.
  const existing = await provisioner.findByClerkId(clerkId);

  // existing should always be defined here — if it somehow isn't, throw so
  // the caller gets a 500 rather than silently proceeding with undefined.
  if (!existing) {
    throw new Error(`provisionUser: no row found for clerkId=${clerkId} after conflict`);
  }

  return existing;
}
