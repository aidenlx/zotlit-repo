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
  const slot = await acquireDesktopSlotOrExit({
    cwd,
    command: "pnpm docs-walk",
    silenceMs: SILENCE_LIMIT_MS.docsWalk,
  });
  const pdfSidebar = await (async () => {
    if (!(await isObsidianReachable(cwd))) return;
    await assertDevBundleFresh(cwd, "apps/reader");
    await assertDevBundleFresh(cwd, "apps/obsidian");
    return await pinPdfSidebar();
  })().catch((error: unknown) => {
    slot.release();
    throw error;
  });
  if (!pdfSidebar) {
    slot.release();
    return;
  }
  return async () => {
    try {
      await pdfSidebar[Symbol.asyncDispose]();
    } finally {
      slot.release();
    }
  };
}
