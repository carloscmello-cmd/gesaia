/**
 * requireAuth middleware
 *
 * Verifies that a valid Clerk session is attached to the request.
 * If not, responds 401. Also ensures the user row exists in our DB
 * (auto-creates on first request using Clerk JWT claims).
 *
 * Usage:
 *   router.get("/me", requireAuth, handler);
 */

import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { provisionUser, DEFAULT_PROVISIONED_ROLE, type UserProvisioner } from "./provisionUser.ts";
import { continueWithEnabledAccount } from "./accountStatus.ts";

export { requireRole } from "./authorization.ts";

/** Fetch the primary email for a Clerk user via the backend API (never undefined). */
async function fetchClerkEmail(userId: string): Promise<string | undefined> {
  try {
    const cu = await clerkClient.users.getUser(userId);
    return cu.emailAddresses.find(e => e.id === cu.primaryEmailAddressId)?.emailAddress
        ?? cu.emailAddresses[0]?.emailAddress;
  } catch {
    return undefined;
  }
}

/** Fetch the display name for a Clerk user via the backend API. */
async function fetchClerkName(userId: string): Promise<string | undefined> {
  try {
    const cu = await clerkClient.users.getUser(userId);
    return [cu.firstName, cu.lastName].filter(Boolean).join(" ") || cu.username || undefined;
  } catch {
    return undefined;
  }
}

/** Drizzle-backed implementation of UserProvisioner. */
function makeProvisioner(): UserProvisioner {
  return {
    async insertIfAbsent(clerkId, email, name) {
      // ON CONFLICT DO NOTHING silences the unique-constraint error when a
      // concurrent request has already inserted the same clerkId.
      const rows = await db
        .insert(users)
        .values({ clerkId, email, name, role: DEFAULT_PROVISIONED_ROLE, language: "pt" })
        .onConflictDoNothing()
        .returning();
      return rows[0] ?? null;
    },

    async findByClerkId(clerkId) {
      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1);
      return row;
    },
  };
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { userId, sessionClaims } = getAuth(req);

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Attach clerk user id for downstream handlers
  (req as any).clerkUserId = userId;

  // Ensure user row exists; create on first login
  let [user] = await db.select().from(users).where(eq(users.clerkId, userId)).limit(1);

  // Prefer email/name from JWT claims; fall back to Clerk backend API when missing
  const claimEmail = sessionClaims?.email as string | undefined;
  const claimName  = (sessionClaims?.name as string | undefined)
                  ?? (sessionClaims?.firstName as string | undefined);

  if (!user) {
    // First login — try claims first, then hit Clerk API to get real email/name
    const email = claimEmail ?? await fetchClerkEmail(userId) ?? `${userId}@unknown.clerk`;
    const name  = claimName  ?? await fetchClerkName(userId)  ?? "User";

    // provisionUser uses ON CONFLICT DO NOTHING to handle concurrent first-login
    // requests safely — no more 500 errors when the UI fires multiple parallel
    // requests on the very first page load.
    user = await provisionUser(makeProvisioner(), userId, email, name);
  } else {
    // Subsequent logins — heal placeholder values whenever we can
    const needsUpdate: Record<string, string> = {};
    if (user.email.endsWith("@unknown.clerk")) {
      const realEmail = claimEmail ?? await fetchClerkEmail(userId);
      if (realEmail) needsUpdate.email = realEmail;
    }
    if (user.name === "User") {
      const realName = claimName ?? await fetchClerkName(userId);
      if (realName) needsUpdate.name = realName;
    }
    if (Object.keys(needsUpdate).length > 0) {
      [user] = await db.update(users).set(needsUpdate).where(eq(users.clerkId, userId)).returning();
    }
  }

  // Block disabled accounts — do not auto-provision a new row for them
  if (!continueWithEnabledAccount(req, user, res, next)) {
    return;
  }
}
