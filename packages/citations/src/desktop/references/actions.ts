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

export interface CopyBibliographySnapshot extends ReferencesCopyTarget {
  entries: readonly CopiedBibliographyEntry[];
}

export interface ReferenceActions {
  onSelect: (entry: ReferenceEntry) => void;
  onOpenNote: (entry: ReferenceEntry) => void;
  onOpenInZotero: (source: ReferenceSource) => void;
  onShowInLibrary: (source: ReferenceSource) => void;
  onOpenAttachment: (source: ReferenceSource, event: MouseEvent) => void;
  onOpenEngineSettings: () => void;
  onChangeStyle: () => void;
  onSwitchProfile: (path: string) => void;
  onDismissEngineHint: () => void;
  onCopyBibliography: (target: ReferencesCopyTarget) => Promise<void>;
}

export interface ReferenceActionDeps {
  app: App;
  getSourcePath: () => string | null;
  openIndexedKey: (indexedKey: string) => void;
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
  getCopySnapshot: () => CopyBibliographySnapshot | null;
  writeClipboard: (
    content: CopiedBibliography,
  ) => Promise<ClipboardRepresentation>;
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
      if (source.attachments === "unreadable") return;
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

export type CopyBibliographyOutcome =
  | { kind: "changed" }
  | { kind: "failed" }
  | { kind: "copied"; representation: ClipboardRepresentation };

export async function copyBibliography(
  deps: Pick<ReferenceActionDeps, "getCopySnapshot" | "writeClipboard">,
  target: ReferencesCopyTarget,
): Promise<CopyBibliographyOutcome> {
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

export function copyBibliographyMessage(
  outcome: CopyBibliographyOutcome,
): string {
  switch (outcome.kind) {
    case "changed":
      return m.references_copy_changed();
    case "failed":
      return m.references_copy_failed();
    case "copied":
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
