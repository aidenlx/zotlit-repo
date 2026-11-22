import { $ } from "zx";

import { SOURCE_BRANCH } from "@zotlit/config/repositories";

export async function affectedBase(root: string): Promise<string | undefined> {
  const mergeBase = await $({
    cwd: root,
    nothrow: true,
    quiet: true,
  })`git merge-base HEAD ${`origin/${SOURCE_BRANCH}`}`;
  return mergeBase.exitCode === 0 ? mergeBase.stdout.trim() : undefined;
}
