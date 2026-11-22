import {
  acquireDesktopSlotOrExit,
  SILENCE_LIMIT_MS,
} from "@zotlit/scripts/desktop-slot";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { pinPdfSidebar } from "./pdf-sidebar-pin.ts";
import { isObsidianReachable } from "./vault-script.ts";

export default async function setup() {
  const cwd = await getWorkspaceRoot(import.meta.dirname);
  if (process.env.ZOTLIT_RUN_CONTAINER) {
    const sidebar = await pinPdfSidebar();
    return () => sidebar[Symbol.asyncDispose]();
  }
  const slot = await acquireDesktopSlotOrExit({
    cwd,
    command: "pnpm e2e",
    silenceMs: SILENCE_LIMIT_MS.e2e,
  });
  const pdfSidebar = await (async () => {
    if (!(await isObsidianReachable(cwd))) return;
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
