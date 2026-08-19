import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { hasRequiredRole } from "../middlewares/authorization.ts";
import { getUserCompanyAuditResponse } from "./userCompanyAudit.ts";
import { createUserManagementRouter, type UserManagementHandlers } from "./userManagementRouter.ts";

const NON_ADMIN_ROLES = ["consultant", "manager", "viewer"] as const;

const ADMIN_ONLY_USER_REQUESTS = [
  { name: "list users", method: "GET", path: "/" },
  { name: "audit a user's companies", method: "GET", path: "/42/companies" },
  { name: "list pending invitations", method: "GET", path: "/invitations" },
  { name: "send invitations", method: "POST", path: "/invite" },
  { name: "revoke invitations", method: "DELETE", path: "/invitations/invitation_123" },
  { name: "resend invitations", method: "POST", path: "/invitations/invitation_123/resend" },
  { name: "edit another user", method: "PATCH", path: "/42" },
  { name: "disable another user", method: "DELETE", path: "/42" },
] as const;

function createTrackingHandlers(calls: string[]): UserManagementHandlers {
  const handler = (operation: string): RequestHandler => (_req, res) => {
    calls.push(operation);
    res.status(200).json({ operation });
  };

  return {
    listUsers: handler("list users"),
    listUserCompanies: handler("audit a user's companies"),
    listInvitations: handler("list pending invitations"),
    createInvitation: handler("send invitations"),
    revokeInvitation: handler("revoke invitations"),
    resendInvitation: handler("resend invitations"),
    updateUser: handler("edit another user"),
    disableUser: handler("disable another user"),
  };
}

async function withUserManagementServer(
  role: string,
  callback: (baseUrl: string, calls: string[]) => Promise<void>,
) {
  const calls: string[] = [];
  const app = express();
  app.use(express.json());
  app.use(
    "/api/users",
    createUserManagementRouter({
      authMiddleware: ((req, _res, next) => {
        (req as any).dbUser = { id: 1, role };
        next();
      }) as RequestHandler,
      handlers: createTrackingHandlers(calls),
    }),
  );

  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await callback(`http://127.0.0.1:${address.port}/api/users`, calls);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function requestUserManagementEndpoint(
  baseUrl: string,
  request: (typeof ADMIN_ONLY_USER_REQUESTS)[number],
) {
  return fetch(`${baseUrl}${request.path}`, { method: request.method });
}

test("non-admin roles receive 403 from every user-management endpoint", async () => {
  for (const role of NON_ADMIN_ROLES) {
    await withUserManagementServer(role, async (baseUrl, calls) => {
      for (const request of ADMIN_ONLY_USER_REQUESTS) {
        const response = await requestUserManagementEndpoint(baseUrl, request);

        assert.equal(response.status, 403, `${role} should be denied access to ${request.name}`);
        assert.deepEqual(await response.json(), { error: "Forbidden" });
      }

      assert.deepEqual(calls, [], `${role} must be denied before any management handler executes`);
    });
  }
});

test("administrators can reach every user-management endpoint", async () => {
  await withUserManagementServer("admin", async (baseUrl, calls) => {
    for (const request of ADMIN_ONLY_USER_REQUESTS) {
      const response = await requestUserManagementEndpoint(baseUrl, request);

      assert.equal(response.status, 200, `admin should reach ${request.name}`);
      assert.deepEqual(await response.json(), { operation: request.name });
    }

    assert.deepEqual(calls, ADMIN_ONLY_USER_REQUESTS.map((request) => request.name));
  });
});

test("company audit requires the administrator role", () => {
  for (const role of NON_ADMIN_ROLES) {
    assert.equal(
      hasRequiredRole({ role }, ["admin"]),
      false,
      `${role} should not access the company audit`,
    );
  }

  assert.equal(hasRequiredRole({ role: "admin" }, ["admin"]), true);
});

test("company audit returns only companies owned by the selected user", async () => {
  const requestedOwnerIds: number[] = [];
  const store = {
    async findUserById(id: number) {
      return id === 12 ? { id } : undefined;
    },
    async findCompaniesByOwnerId(ownerId: number) {
      requestedOwnerIds.push(ownerId);
      return ownerId === 12
        ? [{ id: 101, name: "Consultant 12's Company" }]
        : [{ id: 202, name: "Another Consultant's Company" }];
    },
  };

  const response = await getUserCompanyAuditResponse(12, store);

  assert.deepEqual(requestedOwnerIds, [12]);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, [{ id: 101, name: "Consultant 12's Company" }]);
});

test("company audit reports a missing user without querying companies", async () => {
  let companiesQueried = false;
  const store = {
    async findUserById() {
      return undefined;
    },
    async findCompaniesByOwnerId() {
      companiesQueried = true;
      return [];
    },
  };

  const response = await getUserCompanyAuditResponse(999, store);

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "User not found" });
  assert.equal(companiesQueried, false);
});