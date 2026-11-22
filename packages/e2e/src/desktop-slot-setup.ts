import {
  acquireDesktopSlotOrExit,
  SILENCE_LIMIT_MS,
} from "@zotlit/scripts/desktop-slot";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { startContainerObsidian } from "./container-obsidian.ts";
import { pinPdfSidebar } from "./pdf-sidebar-pin.ts";
import { isObsidianReachable } from "./vault-script.ts";

export default async function setup() {
  const cwd = await getWorkspaceRoot(import.meta.dirname);
  if (process.env.ZOTLIT_RUN_CONTAINER) {
    await startContainerObsidian();
    const sidebar = await pinPdfSidebar();
    return () => sidebar[Symbol.asyncDispose]();
  }
  if (!(await isObsidianReachable(cwd))) return;
  const slot = await acquireDesktopSlotOrExit({
    cwd,
    command: "pnpm e2e",
    silenceMs: SILENCE_LIMIT_MS.e2e,
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
