// The Desktop Slot admission of a docs-walk run, before its walks open.

import { assertDevBundleFresh } from "@e2e/bundle-freshness.ts";
import { pinPdfSidebar } from "@e2e/pdf-sidebar-pin.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";

import {
  acquireDesktopSlotOrExit,
  SILENCE_LIMIT_MS,
} from "@zotlit/scripts/desktop-slot";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { exclusiveHoldRequested } from "./docs-walk.ts";

/**
 * The global setup of `pnpm --filter @zotlit/e2e docs-walk`: one Desktop Slot
 * for the run, or an Exclusive Hold of every slot
 * ({@link exclusiveHoldRequested}), with Obsidian's PDF sidebar held closed
 * for the run ({@link pinPdfSidebar}). A run without a reachable Obsidian
 * skips its walks and takes no slot.
 * @throws when the run needs an Exclusive Hold and reuses an outer hold of
 * one slot.
 */
export default async function setup() {
  const cwd = await getWorkspaceRoot(import.meta.dirname);
  if (!(await isObsidianReachable(cwd))) return;
  // A walk proves the page against the code as it is now, not an old bundle.
  await assertDevBundleFresh(cwd, "apps/obsidian");
  const exclusive = exclusiveHoldRequested();
  const slot = await acquireDesktopSlotOrExit({
    cwd,
    command: "pnpm docs-walk",
    exclusive,
    silenceMs: SILENCE_LIMIT_MS.docsWalk,
  });
  if (exclusive && slot.reused && !slot.owner.exclusive) {
    slot.release();
    throw new Error(
      `this docs walk captures or records, so it needs an Exclusive Hold, but it runs under the hold of one Desktop Slot that pid ${slot.owner.pid} (${slot.owner.command}) has. Start the outer hold with \`pnpm desktop-slot run --exclusive\`, or run the walk outside it.`,
    );
  }
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
