#!/usr/bin/env bash

set -euo pipefail

if [ "${INVITATION_E2E_ENVIRONMENT:-}" != "non-production" ]; then
  echo "Refusing to run the invitation release check outside the non-production E2E environment." >&2
  exit 1
fi

for variable in CLERK_SECRET_KEY CLERK_PUBLISHABLE_KEY VITE_CLERK_PUBLISHABLE_KEY; do
  if [ -n "${!variable:-}" ]; then
    echo "Refusing to run with production Clerk variable ${variable} in the environment." >&2
    exit 1
  fi
done

: "${INVITATION_E2E_APP_URL:?INVITATION_E2E_APP_URL is required}"
: "${INVITATION_E2E_CLERK_SECRET_KEY:?INVITATION_E2E_CLERK_SECRET_KEY is required}"
: "${INVITATION_E2E_ADMIN_USER_ID:?INVITATION_E2E_ADMIN_USER_ID is required}"
: "${MAILOSAUR_API_KEY:?MAILOSAUR_API_KEY is required}"
: "${MAILOSAUR_SERVER_ID:?MAILOSAUR_SERVER_ID is required}"

export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${HOME}/.cache/ms-playwright}"

pnpm --filter @workspace/api-server exec playwright install --with-deps chromium
exec pnpm --filter @workspace/api-server run test:invitation-revocation