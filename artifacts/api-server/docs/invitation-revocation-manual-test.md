# Invitation revocation manual test

The automated browser regression check is the release gate for this behavior:
see [Invitation revocation browser test](./invitation-revocation-browser-test.md).
It uses a dedicated non-production Clerk tenant and disposable Mailosaur
mailboxes, including cleanup of every invitation and test account.

Use the manual scenarios below only to investigate a failed browser check or a
tenant-specific Clerk configuration change. Run them against a non-production
Clerk instance with a disposable recipient mailbox and use a fresh invitation
for each scenario.

## Scenario 1: revoking a pending invitation invalidates its original URL

1. Sign in to GESAIA as an administrator.
2. Invite the disposable recipient from **Usuários** (or create the invitation
   through `POST /api/users/invite`).
3. Record both:
   - the invitation `id` returned by the API/list endpoint; and
   - the original sign-up URL from the Clerk invitation email.
4. Open the original URL in a private browser window. Confirm that it reaches
   the expected Clerk sign-up flow, but do not complete sign-up.
5. While still signed in as the administrator, send the revoke request from
   the same application origin so the existing Clerk session is used:

   ```js
   const response = await fetch("/api/users/invitations/<invitation-id>", {
     method: "DELETE",
     credentials: "include",
   });
   console.log(response.status);
   ```

   **Expected:** `204`, with no response body. The invitation also disappears
   from the pending-invitations list.
6. Open the **same original sign-up URL** again in a new private window (or
   reload it after clearing the Clerk page state).

   **Expected:** Clerk displays an invalid, expired, or revoked invitation
   error. It must not display a usable sign-up form, accept the invitation, or
   create a user/session. The exact Clerk error wording can vary by tenant and
   localization; the important assertion is that the original URL cannot
   complete sign-up.

## Scenario 2: an already-accepted invitation returns 404 cleanly

1. Create a second invitation for another disposable mailbox and record its
   invitation `id` and original URL.
2. Open the URL and complete the Clerk sign-up flow successfully.
3. As an administrator, send the same DELETE request, replacing
   `<invitation-id>` with the already-accepted invitation's ID:

   ```js
   const response = await fetch("/api/users/invitations/<invitation-id>", {
     method: "DELETE",
     credentials: "include",
   });
   console.log(response.status, await response.json());
   ```

   **Expected:** `404` and:

   ```json
   { "error": "Invitation not found" }
   ```

   The request must not return `502` or an unhandled server error. This is
   expected because Clerk removes accepted invitations from its pending
   invitation set, so there is nothing left to revoke.

Record the date, non-production Clerk tenant/environment, invitation IDs, and
the observed error text/status in the release test notes. Revoke any pending
test invitation and delete any test Clerk user before closing the investigation.