import type { NextFunction, Request, Response } from "express";

export function hasRequiredRole(
  user: { role?: string } | undefined,
  roles: readonly string[],
): boolean {
  return Boolean(user && roles.includes(user.role ?? ""));
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).dbUser;
    if (!hasRequiredRole(user, roles)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}