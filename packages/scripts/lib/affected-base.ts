import { $ } from "zx";

import { SOURCE_BRANCH } from "@zotlit/config/repositories";

export const DEFAULT_AFFECTED_REF = `origin/${SOURCE_BRANCH}`;

export async function affectedBase(
  root: string,
  ref: string = DEFAULT_AFFECTED_REF,
): Promise<string | undefined> {
  const mergeBase = await $({
    cwd: root,
    nothrow: true,
    quiet: true,
  })`git merge-base HEAD ${ref}`;
  return mergeBase.exitCode === 0 ? mergeBase.stdout.trim() : undefined;
}
