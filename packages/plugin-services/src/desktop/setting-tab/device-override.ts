// Shared pieces for the settings rows that hold Device Overrides — state kept
// per vault × device that never syncs: the folder dialog that picks a
// machine-specific folder, and the note that says the value stays here.

import { Effect } from "effect";

import { requireDialog } from "@zotlit/obsidian-desktop/require.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

/**
 * Open a folder picker and hand the chosen directory to `onPick`. `startPath`
 * seeds the dialog when the bound setting is unset.
 */
export async function browseForDir(opts: {
  title: string;
  startPath: string | undefined;
  onPick: (path: string) => void;
}): Promise<void> {
  try {
    const result = await requireDialog().showOpenDialog({
      title: opts.title,
      defaultPath: opts.startPath,
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    opts.onPick(result.filePaths[0]!);
  } catch (error) {
    Effect.runSyncWith(logServices)(
      Effect.logError("Failed to open folder dialog").pipe(
        Effect.annotateLogs({ error }),
        withLogCategory("setting-tab", "device-override"),
      ),
    );
  }
}

/** Append the "stored on this device only" Device Override note as a fresh description line. */
export function appendDeviceOverrideNote(frag: DocumentFragment): void {
  frag.append(createEl("br"));
  const note = createEl("small");
  note.textContent = m.settings_db_device_override_note();
  frag.append(note);
}
