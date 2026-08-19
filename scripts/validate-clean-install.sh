#!/bin/sh

set -eu

temp_dir=$(mktemp -d)

cleanup() {
  rm -rf "$temp_dir"
}

trap cleanup EXIT INT TERM

tar \
  --exclude='./.git' \
  --exclude='node_modules' \
  --exclude='*/node_modules' \
  -cf - . | tar -xf - -C "$temp_dir"

if find "$temp_dir" -type d -name node_modules -print -quit | grep -q .; then
  echo "Clean-install staging unexpectedly contains node_modules" >&2
  exit 1
fi

cd "$temp_dir"
pnpm install --frozen-lockfile
pnpm --filter @workspace/gesaia test
pnpm --filter @workspace/api-server test