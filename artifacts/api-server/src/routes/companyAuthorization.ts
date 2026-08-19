export type CompanyOwner = {
  ownerId: number;
};

export type AuthorizedUser = {
  id: number;
  role?: string;
};

export function canAccessCompany(user: AuthorizedUser, company: CompanyOwner): boolean {
  return user.role === "admin" || company.ownerId === user.id;
}