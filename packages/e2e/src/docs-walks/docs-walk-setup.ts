import { assertDevBundleFresh } from "@e2e/bundle-freshness.ts";
import { pinPdfSidebar } from "@e2e/pdf-sidebar-pin.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";

import {
  acquireDesktopSlotOrExit,
  SILENCE_LIMIT_MS,
} from "@zotlit/scripts/desktop-slot";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

export default async function setup() {
  const cwd = await getWorkspaceRoot(import.meta.dirname);
  if (!(await isObsidianReachable(cwd))) return;
  await assertDevBundleFresh(cwd, "apps/reader");
  await assertDevBundleFresh(cwd, "apps/obsidian");
  const slot = await acquireDesktopSlotOrExit({
    cwd,
    command: "pnpm docs-walk",
    silenceMs: SILENCE_LIMIT_MS.docsWalk,
  });
  const pdfSidebar = await pinPdfSidebar().catch((error: unknown) => {
    slot.release();
    throw error;
  });
  return async () => {
    try {
      await pdfSidebar[Symbol.asyncDispose]();
    } finally {
      slot.release();
    }
  };
}
