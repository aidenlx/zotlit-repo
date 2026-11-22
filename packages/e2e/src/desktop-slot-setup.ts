import {
  acquireDesktopSlotOrExit,
  SILENCE_LIMIT_MS,
} from "@zotlit/scripts/desktop-slot";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { pinPdfSidebar } from "./pdf-sidebar-pin.ts";
import { isObsidianReachable } from "./vault-script.ts";

export default async function setup() {
  const cwd = await getWorkspaceRoot(import.meta.dirname);
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
