import { basename, dirname, join } from "node:path";

import { getFixtureLayout, getFixtureRoot } from "./fixture/layout.ts";
import { DEFAULT_VAULT_CASE } from "./fixture/spec.ts";

export const DEV_VAULT_CASE_ENV = "ZT_VAULT_CASE";

export function getWorktreeVaultName(workspaceRoot: string): string {
  const worktreeName = basename(workspaceRoot);
  const worktreeParent = dirname(workspaceRoot);
  const worktreesDir = dirname(worktreeParent);
  const codexWorktree =
    basename(worktreesDir) === "worktrees" &&
    basename(dirname(worktreesDir)) === ".codex";
  return codexWorktree
    ? `${worktreeName}-${basename(worktreeParent)}`
    : worktreeName;
}

export function getDevVaultDir(
  workspaceRoot: string,
  vaultCase: string = DEFAULT_VAULT_CASE,
): string {
  const caseSuffix = vaultCase === DEFAULT_VAULT_CASE ? "" : `-${vaultCase}`;

  return join(
    workspaceRoot,
    "tests",
    `fixture-vault-${getWorktreeVaultName(workspaceRoot)}${caseSuffix}`,
  );
}

export function getFixtureVaultDir(workspaceRoot: string): string {
  return getFixtureLayout(getFixtureRoot(workspaceRoot)).vaultDir;
}
