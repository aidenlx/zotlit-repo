#!/usr/bin/env zx

// only for the type checker
import type {} from "zx/globals";

$.verbose = true;

// path to the primary worktree; wt itself copies gitignored files matched by
// .worktreeinclude when creating the worktree
const primary = argv._[0];

if (primary) {
  await $`pnpm install --frozen-lockfile --prefer-offline`;
} else {
  await $`pnpm install --frozen-lockfile`;
}

await $`turbo run build --filter=./packages/*`;

// Obsidian checks need the generated message facade. The docs Vite lifecycle
// generates its collections and messages during dev/build.
await $`turbo run generate:language-packs`;
