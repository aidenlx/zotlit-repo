// What a References Sidebar entry can do: navigate the document, and reach the Item in Zotero.

import type {
  CitationOccurrence,
  ReferenceSource,
} from "#obsidian/citation-index/service.ts";
import type {
  CopiedBibliography,
  CopiedBibliographyEntry,
} from "#obsidian/references/copied-bibliography.ts";
import type { ReferenceEntry } from "#obsidian/references/entries.ts";
import type { ReferencesCopyTarget } from "#obsidian/references/state.ts";
import { Effect } from "effect";
import type { App } from "obsidian";
import { createContext, useContext } from "react";
import type { MouseEvent } from "react";

import {
  openAttachments,
  zoteroAttachmentReader,
} from "@zotlit/annotations/desktop/attachment-open/open-attachments.ts";
import { requestProfileSwitch } from "@zotlit/obsidian-kit/profile-recovery.ts";
import type { ClipboardRepresentation } from "@zotlit/plugin-kernel/clipboard.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";
import { itemSelectUri } from "@zotlit/zotero-types/uri";

import { toCopiedBibliography } from "#obsidian/references/copied-bibliography.ts";

/** The completed bibliography one copy is taken from, and what it answers for. */
export interface CopyBibliographySnapshot extends ReferencesCopyTarget {
  entries: readonly CopiedBibliographyEntry[];
}

export interface ReferenceActions {
  /** Move the editor to the entry's next occurrence, wrapping at the end. */
  onSelect: (entry: ReferenceEntry) => void;
  onOpenNote: (entry: ReferenceEntry) => void;
  onOpenInZotero: (source: ReferenceSource) => void;
  onShowInLibrary: (source: ReferenceSource) => void;
  /**
   * Open the Item's Attachment in Zotero's reader. A single Attachment opens
   * straight away; several offer a menu at the click.
   */
  onOpenAttachment: (source: ReferenceSource, event: MouseEvent) => void;
  /** Reveal the Pandoc engine row in settings, which states why the engine is unavailable. */
  onOpenEngineSettings: () => void;
  /** Reveal the Citation and References Style row in settings. */
  onChangeStyle: () => void;
  onSwitchProfile: (path: string) => void;
  /** Close the hint that offers the Resource Pack. */
  onDismissEngineHint: () => void;
  /**
   * Put the offered bibliography on the clipboard as a Copied Bibliography.
   *
   * @param target the note and generation the click was taken on, so a list
   *   that moved on between the render and the click is refused.
   */
  onCopyBibliography: (target: ReferencesCopyTarget) => Promise<void>;
}

export interface ReferenceActionDeps {
  app: App;
  /** Path of the document the listed references were scanned from. */
  getSourcePath: () => string | null;
  /** Open the Literature Note of the Item an Indexed Key names, creating it first when it has none. */
  openIndexedKey: (indexedKey: string) => void;
  /** Open the Library View on the Item an Indexed Key names. */
  showInLibrary: (indexedKey: string) => void;
  openLinkText: (linkpath: string, sourcePath: string) => void;
  nextOccurrence: (id: string, count: number) => number;
  revealOccurrence: (
    sourcePath: string,
    occurrence: CitationOccurrence,
  ) => void;
  onOpenEngineSettings: () => void;
  onChangeStyle: () => void;
  onDismissEngineHint: () => void;
  /** The bibliography a copy would take, or `null` while copy is unavailable. */
  getCopySnapshot: () => CopyBibliographySnapshot | null;
  /**
   * Hand the serialized snapshot to the platform clipboard, and answer with the
   * representation it took.
   */
  writeClipboard: (
    content: CopiedBibliography,
  ) => Promise<ClipboardRepresentation>;
  /**
   * Show how a bibliography copy ended; the seam that owns notices supplies
   * it.
   */
  reportCopy: (outcome: CopyBibliographyOutcome) => void;
}

export function createReferenceActions(
  deps: ReferenceActionDeps,
): ReferenceActions {
  return {
    onSelect(entry) {
      const sourcePath = deps.getSourcePath();
      if (!sourcePath || entry.occurrences.length === 0) return;
      const next = deps.nextOccurrence(entry.id, entry.occurrences.length);
      deps.revealOccurrence(sourcePath, entry.occurrences[next]!);
    },
    onOpenNote(entry) {
      // An unresolved citekey reaches no note, an ambiguous one reaches
      // several and adopts none, and a missing entry's Item could not be read
      // at all; each keeps its row's action disabled.
      if (
        entry.kind === "unresolved" ||
        entry.kind === "ambiguous" ||
        entry.kind === "missing" ||
        entry.kind === "ineligible" ||
        entry.kind === "unreadable" ||
        entry.kind === "malformed"
      ) {
        return;
      }
      // The resolved Item identity also reaches parents without a Citation Key.
      if (entry.linkpath === null) {
        deps.openIndexedKey(entry.id);
        return;
      }
      deps.openLinkText(entry.linkpath, deps.getSourcePath() ?? "");
    },
    onOpenInZotero(source) {
      window.open(itemSelectUri(source.itemKey, source.groupID));
    },
    onShowInLibrary(source) {
      deps.showInLibrary(formatIndexedKey(source.itemKey, source.groupID));
    },
    onOpenAttachment(source, event) {
      openAttachments(source.attachments, {
        reader: zoteroAttachmentReader,
        host: deps.app,
        event,
      });
    },
    onOpenEngineSettings: deps.onOpenEngineSettings,
    onChangeStyle: deps.onChangeStyle,
    onSwitchProfile: (path) => requestProfileSwitch(deps.app, path),
    onDismissEngineHint: deps.onDismissEngineHint,
    async onCopyBibliography(target) {
      deps.reportCopy(await copyBibliography(deps, target));
    },
  };
}

/** How one bibliography copy ended. */
export type CopyBibliographyOutcome =
  /** The pane moved on from the snapshot the click was taken on. */
  | { kind: "changed" }
  /** The platform clipboard refused the write. */
  | { kind: "failed" }
  | { kind: "copied"; representation: ClipboardRepresentation };

/**
 * Put the offered bibliography on the clipboard as a Copied Bibliography.
 *
 * @param target the note and generation the click was taken on, so a list
 *   that moved on between the render and the click is refused.
 */
export async function copyBibliography(
  deps: Pick<ReferenceActionDeps, "getCopySnapshot" | "writeClipboard">,
  target: ReferencesCopyTarget,
): Promise<CopyBibliographyOutcome> {
  // The click answers for the render the toolbar painted, which the pane
  // is free to leave behind before the handler runs: it may follow another
  // note, finish a newer render, or lose readiness while the enabled
  // button is still on screen. A write taken from any of those would copy
  // a bibliography the sidebar no longer shows, so the commit point takes
  // the snapshot the pane holds now and keeps it only when it is still the
  // one the click was taken on.
  const snapshot = deps.getCopySnapshot();
  if (
    !snapshot ||
    snapshot.path !== target.path ||
    snapshot.generation !== target.generation
  ) {
    Effect.runSyncWith(logServices)(
      Effect.logDebug("Bibliography snapshot changed before the copy").pipe(
        Effect.annotateLogs({
          path: target.path,
          generation: target.generation,
        }),
        withLogCategory("views", "references"),
      ),
    );
    return { kind: "changed" };
  }
  let representation: ClipboardRepresentation;
  try {
    representation = await deps.writeClipboard(
      toCopiedBibliography(snapshot.entries),
    );
  } catch (error) {
    Effect.runSyncWith(logServices)(
      Effect.logError("Cannot copy the bibliography snapshot").pipe(
        Effect.annotateLogs({
          path: snapshot.path,
          error,
        }),
        withLogCategory("views", "references"),
      ),
    );
    return { kind: "failed" };
  }
  Effect.runSyncWith(logServices)(
    Effect.logDebug("Bibliography snapshot copied").pipe(
      Effect.annotateLogs({
        path: snapshot.path,
        generation: snapshot.generation,
        count: snapshot.entries.length,
        representation,
      }),
      withLogCategory("views", "references"),
    ),
  );
  return { kind: "copied", representation };
}

/** The notice that reports how a bibliography copy ended. */
export function copyBibliographyMessage(
  outcome: CopyBibliographyOutcome,
): string {
  switch (outcome.kind) {
    case "changed":
      return m.references_copy_changed();
    case "failed":
      return m.references_copy_failed();
    case "copied":
      // Rich formatting was on offer, so a plain-text result is news: it says
      // why the pasted entries lost their emphasis and small caps.
      return outcome.representation === "rich"
        ? m.references_copy_copied()
        : m.references_copy_copied_text();
  }
}

export const ReferenceActionsContext = createContext<ReferenceActions | null>(
  null,
);

export function useReferenceActions(): ReferenceActions {
  const actions = useContext(ReferenceActionsContext);
  if (!actions) {
    throw new Error(
      "useReferenceActions must be used within ReferenceActionsContext",
    );
  }
  return actions;
}
