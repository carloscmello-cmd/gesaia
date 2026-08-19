import { Router } from "express";
import { asc, eq, count } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { users, companies } from "@workspace/db/schema";
import { requireAuth } from "../middlewares/requireAuth";
import { getUserCompanyAuditResponse, type UserCompanyAuditStore } from "./userCompanyAudit";
import { createUserManagementRouter } from "./userManagementRouter";

const router = Router();

const VALID_ROLES = ["admin", "consultant", "manager", "viewer"] as const;
type Role = (typeof VALID_ROLES)[number];

/** Serialise a user row into the full User API shape (all fields incl. disabled). */
function serializeUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    clerkId: u.clerkId,
    email: u.email,
    name: u.name,
    role: u.role,
    language: u.language,
    disabled: u.disabled,
    createdAt: u.createdAt,
  };
}

function serializePendingInvitation(invitation: {
  id: string;
  emailAddress: string;
  createdAt: number;
}) {
  return {
    id: invitation.id,
    email: invitation.emailAddress,
    status: "pending" as const,
    createdAt: new Date(invitation.createdAt).toISOString(),
  };
}

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function clerkErrorStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return undefined;
}

function clerkErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "errors" in error &&
    Array.isArray((error as { errors?: unknown }).errors)
  ) {
    const [firstError] = (error as { errors: Array<{ code?: unknown }> }).errors;
    return typeof firstError?.code === "string" ? firstError.code : undefined;
  }
  return undefined;
}

function isExistingInvitationError(status: number | undefined, code: string | undefined): boolean {
  return status === 409 || code === "invitation_already_exists" || code === "form_identifier_exists";
}

function getInvitationId(req: { params: Record<string, string | string[]> }): string | undefined {
  const value = req.params.id;
  return typeof value === "string" && value.trim() ? value : undefined;
}

const userCompanyAuditStore: UserCompanyAuditStore = {
  async findUserById(id) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user;
  },

  async findCompaniesByOwnerId(ownerId) {
    return db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.ownerId, ownerId))
      .orderBy(asc(companies.name));
  },
};

// GET /api/users/me
router.get("/me", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  res.json(serializeUser(user));
});

// PATCH /api/users/me
router.patch("/me", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { name, language } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (language !== undefined) updates.language = language;

  if (Object.keys(updates).length === 0) {
    res.json(serializeUser(user));
    return;
  }

  const [updated] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
  res.json(serializeUser(updated));
});

router.use(createUserManagementRouter({
  authMiddleware: requireAuth,
  handlers: {
    listUsers: async (_req, res) => {
      const all = await db.select().from(users).orderBy(users.createdAt);
      res.json(all.map(serializeUser));
    },

    listUserCompanies: async (req, res) => {
      const id = Number(req.params.id);
      const response = await getUserCompanyAuditResponse(id, userCompanyAuditStore);
      res.status(response.status).json(response.body);
    },

    listInvitations: async (req, res) => {
      try {
        const invitations = await clerkClient.invitations.getInvitationList({
          status: "pending",
          limit: 500,
        });
        res.json(invitations.data.map(serializePendingInvitation));
      } catch (error) {
        req.log.warn(
          { clerkStatus: clerkErrorStatus(error), errorName: error instanceof Error ? error.name : "UnknownError" },
          "Unable to list pending Clerk invitations",
        );
        res.status(502).json({ error: "Unable to retrieve pending invitations" });
      }
    },

    createInvitation: async (req, res) => {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : req.body?.email;

      if (!isValidEmail(email)) {
        res.status(400).json({ error: "Provide a valid email address" });
        return;
      }

      try {
        const invitation = await clerkClient.invitations.createInvitation({ emailAddress: email });
        res.status(201).json(serializePendingInvitation(invitation));
      } catch (error) {
        const status = clerkErrorStatus(error);
        const code = clerkErrorCode(error);
        req.log.warn(
          { clerkStatus: status, clerkCode: code, errorName: error instanceof Error ? error.name : "UnknownError" },
          "Unable to create Clerk invitation",
        );

        if (isExistingInvitationError(status, code)) {
          res.status(409).json({
            error: "invitation_already_exists",
            message: "Já existe um usuário ou convite pendente para este e-mail.",
          });
          return;
        }

        if (status !== undefined && status >= 400 && status < 500) {
          res.status(400).json({
            error: "invalid_invitation",
            message: "O Clerk não aceitou este convite. Verifique o e-mail e tente novamente.",
          });
          return;
        }

        res.status(502).json({ error: "Unable to send invitation" });
      }
    },

    revokeInvitation: async (req, res) => {
      const invitationId = getInvitationId(req);
      if (!invitationId) {
        res.status(400).json({ error: "Invitation id must be a non-empty string" });
        return;
      }

      try {
        await clerkClient.invitations.revokeInvitation(invitationId);
        res.status(204).send();
      } catch (error) {
        const status = clerkErrorStatus(error);
        req.log.warn(
          { clerkStatus: status, errorName: error instanceof Error ? error.name : "UnknownError" },
          "Unable to revoke Clerk invitation",
        );
        if (status === 404) {
          res.status(404).json({ error: "Invitation not found" });
          return;
        }
        res.status(502).json({ error: "Unable to revoke invitation" });
      }
    },

    resendInvitation: async (req, res) => {
      const invitationId = getInvitationId(req);
      if (!invitationId) {
        res.status(400).json({ error: "Invitation id must be a non-empty string" });
        return;
      }

      try {
        const invitations = await clerkClient.invitations.getInvitationList({ status: "pending", limit: 500 });
        const existing = invitations.data.find((inv) => inv.id === invitationId);
        if (!existing) {
          res.status(404).json({ error: "Invitation not found or already accepted" });
          return;
        }

        await clerkClient.invitations.revokeInvitation(invitationId);
        try {
          const newInvitation = await clerkClient.invitations.createInvitation({ emailAddress: existing.emailAddress });
          res.status(201).json(serializePendingInvitation(newInvitation));
        } catch (createError) {
          const recovered = await clerkClient.invitations.getInvitationList({ status: "pending", limit: 500 });
          const replacement = recovered.data.find(
            (invitation) => invitation.emailAddress.toLowerCase() === existing.emailAddress.toLowerCase(),
          );
          if (replacement) {
            res.status(201).json(serializePendingInvitation(replacement));
            return;
          }

          const createStatus = clerkErrorStatus(createError);
          const createCode = clerkErrorCode(createError);
          req.log.warn(
            {
              clerkStatus: createStatus,
              clerkCode: createCode,
              errorName: createError instanceof Error ? createError.name : "UnknownError",
              oldInvitationRevoked: true,
            },
            "Invitation was revoked but replacement could not be created",
          );
          res.status(502).json({
            error: "invitation_resend_failed",
            message: "O convite anterior foi revogado, mas não foi possível enviar um novo convite. Envie outro convite para este e-mail.",
            invitationRevoked: true,
          });
        }
      } catch (error) {
        const status = clerkErrorStatus(error);
        const code = clerkErrorCode(error);
        req.log.warn(
          { clerkStatus: status, clerkCode: code, errorName: error instanceof Error ? error.name : "UnknownError" },
          "Unable to resend Clerk invitation",
        );
        if (isExistingInvitationError(status, code)) {
          res.status(409).json({
            error: "invitation_already_exists",
            message: "Já existe um usuário ou convite ativo para este e-mail.",
          });
          return;
        }
        res.status(502).json({ error: "Unable to resend invitation" });
      }
    },

    updateUser: async (req, res) => {
      const id = Number(req.params.id);
      const adminUser = (req as any).dbUser;
      const { role, disabled, name } = req.body;
      const updates: Record<string, unknown> = {};

      if (role !== undefined) {
        if (!VALID_ROLES.includes(role as Role)) {
          res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
          return;
        }
        updates.role = role;
      }

      if (name !== undefined) {
        if (typeof name !== "string" || !name.trim()) {
          res.status(400).json({ error: "name must be a non-empty string" });
          return;
        }
        updates.name = name.trim();
      }

      if (disabled !== undefined) {
        if (typeof disabled !== "boolean") {
          res.status(400).json({ error: "disabled must be a boolean" });
          return;
        }
        if (disabled === true) {
          res.status(400).json({ error: "Use DELETE /api/users/:id to disable access. PATCH only accepts disabled: false (re-enable)." });
          return;
        }
        if (adminUser.id === id) {
          res.status(400).json({ error: "Cannot modify your own account status" });
          return;
        }
        updates.disabled = false;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "Provide role or disabled (false) to update" });
        return;
      }

      const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
      if (!updated) { res.status(404).json({ error: "User not found" }); return; }
      res.json(serializeUser(updated));
    },

    disableUser: async (req, res) => {
      const id = Number(req.params.id);
      const adminUser = (req as any).dbUser;

      if (adminUser.id === id) {
        res.status(400).json({ error: "Cannot remove your own account" });
        return;
      }

      const [{ owned }] = await db
        .select({ owned: count() })
        .from(companies)
        .where(eq(companies.ownerId, id));

      if (Number(owned) > 0) {
        res.status(409).json({
          error: "user_owns_companies",
          message: `This user owns ${owned} company(ies). Reassign or delete them before removing access.`,
          ownedCount: Number(owned),
        });
        return;
      }

      const [disabled] = await db
        .update(users)
        .set({ disabled: true })
        .where(eq(users.id, id))
        .returning();

      if (!disabled) { res.status(404).json({ error: "User not found" }); return; }
      res.status(204).send();
    },
  },
}));

export default router;
