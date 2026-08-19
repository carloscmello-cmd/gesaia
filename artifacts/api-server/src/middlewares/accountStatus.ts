export type AccountStatusUser = {
  disabled: boolean;
};

type AuthenticatedRequest = {
  dbUser?: AccountStatusUser;
};

type StatusResponse = {
  status(code: number): StatusResponse;
  json(value: unknown): StatusResponse;
};

/**
 * Attach enabled database users to the request and advance authentication.
 *
 * Returns false after responding when the account has been disabled.
 */
export function continueWithEnabledAccount(
  req: object,
  user: AccountStatusUser,
  res: StatusResponse,
  next: () => void,
): boolean {
  if (user.disabled) {
    res.status(403).json({ error: "Account disabled" });
    return false;
  }

  (req as AuthenticatedRequest).dbUser = user;
  next();
  return true;
}