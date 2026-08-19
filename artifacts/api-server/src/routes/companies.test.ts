import assert from "node:assert/strict";
import test from "node:test";
import { canAccessCompany } from "./companyAuthorization.ts";

test("a consultant cannot read a company owned by another user", () => {
  const consultant = { id: 12, role: "consultant" };

  assert.equal(canAccessCompany(consultant, { ownerId: 99 }), false);
  assert.equal(canAccessCompany(consultant, { ownerId: consultant.id }), true);
});