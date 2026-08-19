#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm exec tsc -b lib/api-client-react lib/api-zod
pnpm --filter db push
