import { Router, type RequestHandler } from "express";
import { requireRole } from "../middlewares/authorization.ts";

export type UserManagementHandlers = {
  listUsers: RequestHandler;
  listUserCompanies: RequestHandler;
  listInvitations: RequestHandler;
  createInvitation: RequestHandler;
  revokeInvitation: RequestHandler;
  resendInvitation: RequestHandler;
  updateUser: RequestHandler;
  disableUser: RequestHandler;
};

type UserManagementRouterDependencies = {
  authMiddleware: RequestHandler;
  handlers: UserManagementHandlers;
};

/**
 * Registers every administrator-only user-management endpoint.
 *
 * Keeping these routes in one injectable factory lets tests exercise the
 * production route registrations without requiring a live Clerk or database.
 */
export function createUserManagementRouter({
  authMiddleware,
  handlers,
}: UserManagementRouterDependencies) {
  const router = Router();
  const requireAdmin = requireRole("admin");

  router.get("/", authMiddleware, requireAdmin, handlers.listUsers);
  router.get("/:id/companies", authMiddleware, requireAdmin, handlers.listUserCompanies);
  router.get("/invitations", authMiddleware, requireAdmin, handlers.listInvitations);
  router.post("/invite", authMiddleware, requireAdmin, handlers.createInvitation);
  router.delete("/invitations/:id", authMiddleware, requireAdmin, handlers.revokeInvitation);
  router.post("/invitations/:id/resend", authMiddleware, requireAdmin, handlers.resendInvitation);
  router.patch("/:id", authMiddleware, requireAdmin, handlers.updateUser);
  router.delete("/:id", authMiddleware, requireAdmin, handlers.disableUser);

  return router;
}