import { $ } from "zx";

import { SOURCE_BRANCH } from "@zotlit/config/repositories";

/**
 * The merge base with `origin/main`, the trunk. A hotfix branch cut from a
 * stable release tag then checks its own commits since that tag's commit
 * left the trunk.
 */
export async function affectedBase(root: string): Promise<string | undefined> {
  const mergeBase = await $({
    cwd: root,
    nothrow: true,
    quiet: true,
  })`git merge-base HEAD ${`origin/${SOURCE_BRANCH}`}`;
  return mergeBase.exitCode === 0 ? mergeBase.stdout.trim() : undefined;
}
