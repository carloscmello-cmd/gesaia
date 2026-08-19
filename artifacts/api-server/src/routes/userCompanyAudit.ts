export type UserCompanyAuditStore = {
  findUserById: (id: number) => Promise<{ id: number } | undefined>;
  findCompaniesByOwnerId: (ownerId: number) => Promise<Array<{ id: number; name: string }>>;
};

type UserCompanyAuditResponse =
  | { status: 200; body: Array<{ id: number; name: string }> }
  | { status: 404; body: { error: "User not found" } };

export async function getUserCompanyAuditResponse(
  id: number,
  store: UserCompanyAuditStore,
): Promise<UserCompanyAuditResponse> {
  const user = await store.findUserById(id);
  if (!user) {
    return { status: 404, body: { error: "User not found" } };
  }

  return {
    status: 200,
    body: await store.findCompaniesByOwnerId(user.id),
  };
}