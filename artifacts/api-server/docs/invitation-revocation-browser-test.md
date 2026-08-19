# Isolated Clerk browser tests

`pnpm --filter @workspace/api-server run test:invitation-revocation` is the
release regression check for Clerk-hosted invitation URLs and suspended-account
access. It is intentionally separate from the fast API suite because it sends
real email, creates a real browser session, and exercises Clerk's hosted
authentication flow.

The test never reads `CLERK_SECRET_KEY`. It only accepts
`INVITATION_E2E_CLERK_SECRET_KEY`, and refuses to start unless that key begins
with `sk_test_`. This makes a dedicated non-production Clerk tenant mandatory.

## One-time test tenant setup

Create a Clerk development/test tenant that is separate from the tenant used by
production. Configure it with:

- a dedicated administrator whose application database role is `admin`;
- email/password sign-up enabled, with only Clerk's standard first name, last
  name, password, and optional email-code verification fields required;
- the non-production GESAIA application URL as an allowed redirect/origin; and
- a Mailosaur server dedicated to this test suite. The Mailosaur server domain
  must be allowed by the Clerk tenant's invitation email delivery settings.

The administrator is a long-lived fixture for the non-production tenant. Every
invitee is generated with a fresh Mailosaur address and deleted at the end of
the test. The suspended-account check creates a fresh disposable Clerk user,
provisions its application user row through `/api/users/me`, disables that row
through the administrator API, and deletes the Clerk user during cleanup.

## Required test secrets and configuration

Set these only in a protected CI environment named `invitation-e2e`, which must
contain the dedicated non-production Clerk tenant and Mailosaur server:

| Variable | Purpose |
| --- | --- |
| `INVITATION_E2E_ENVIRONMENT` | Must be exactly `non-production`. |
| `INVITATION_E2E_APP_URL` | Running non-production GESAIA URL, for example `https://<dev-domain>/`. |
| `INVITATION_E2E_CLERK_SECRET_KEY` | Dedicated Clerk **test** secret key (`sk_test_...`). |
| `INVITATION_E2E_ADMIN_USER_ID` | Clerk user ID for the dedicated non-production administrator. |
| `MAILOSAUR_API_KEY` | API key for the dedicated Mailosaur server. |
| `MAILOSAUR_SERVER_ID` | Dedicated Mailosaur server ID. |

The release-gate workflow maps only these five values into the browser-test
job. It does not map `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
`VITE_CLERK_PUBLISHABLE_KEY`, a production application URL, or production
database credentials. The test also refuses to start if a production Clerk
variable is present. Keep the `invitation-e2e` environment separate from the
production deployment environment and do not add production secrets to it.

The workflow runs for pushes to `main`, can be called by a release workflow, and
can be started manually. Protect the `invitation-e2e` environment and require
the `Run isolated Clerk invitation browser test` status check before merging or
publishing a release. A failed assertion, browser-install step, or cleanup
failure returns a non-zero status and blocks the gate.

The release gate caches Playwright's browser directory and runs this command
before every test attempt, so a cache miss installs Chromium before the suite
runs:

```sh
pnpm run test:invitation-revocation:release
```

For a direct local run, provide the same dedicated non-production values and
set `INVITATION_E2E_ENVIRONMENT=non-production`, then run:

```sh
export INVITATION_E2E_ENVIRONMENT=non-production
pnpm --filter @workspace/api-server run test:invitation-revocation
```

The suite allows up to six minutes because a run can wait for two invitation
emails, an optional verification email, and then must still complete cleanup.

## What the browser tests prove

For each run, the suite creates two unique Mailosaur mailboxes and obtains the
original sign-up URL from each real invitation email:

1. It opens the first URL in a new browser context to confirm it is initially
   usable, revokes that invitation with
   `DELETE /api/users/invitations/:id`, and expects `204` with no response
   body.
2. It opens the exact same URL in another clean browser context and requires
   Clerk to show an invalid/expired/revoked state, with no password sign-up
   control and no GESAIA session.
3. It accepts the second invitation through Clerk's browser sign-up flow. It
   then calls the same API DELETE endpoint and expects the clean API response
   `404 { "error": "Invitation not found" }`, never a `502`.

The `finally` cleanup revokes every still-pending invitation, deletes any Clerk
user created for a generated mailbox, removes the individual Mailosaur
messages, and closes every browser context. A cleanup failure fails the test
when there was no earlier assertion failure, so no reusable test account or
invitation can be silently left behind.

The suspended-account test additionally proves that:

1. a real Clerk session can authenticate a user whose application database row
   has been disabled;
2. `GET /api/users/me` returns `403 { "error": "Account disabled" }`; and
3. the route's normal response is not produced, so the protected handler is not
   reached after the authentication middleware rejects the request.