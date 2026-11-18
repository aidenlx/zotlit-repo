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

// Workspace packages export their TypeScript source, so nothing builds here.
// Turbo generates these files before each task that reads them; generating
// them now gives the editor the plugin's message facade and the Workbench
// message contract. The docs Vite lifecycle generates its collections and
// messages during dev/build.
await $`turbo run generate:language-packs generate:message-types`;
