import type { Inlines } from "#core/pandoc/ast.ts";
import type {
  AmbiguousCandidate,
  AmbiguousCandidatesOf,
} from "#obsidian/citation-index/ambiguity.ts";
import type { HoveredWork } from "#obsidian/citekey-navigation/index.ts";
import type { ReferenceEntry } from "#obsidian/references/entries.ts";

import type { ZoteroOpenableAttachment } from "@zotlit/plugin-services/core/attachment-resolver/zotero-openable.ts";

export interface CitationEntryBlock {
  kind: "entry";
  citekey: string | null;
  marker: Inlines | undefined;
  serial: number | undefined;
  content: Inlines | null;
  summary: string;
  itemKey: string;
  groupID: number | null;
  attachments: readonly ZoteroOpenableAttachment[];
}

export interface UnresolvedCitationBlock {
  kind: "unresolved";
  citekey: string;
}

export interface AmbiguousCitationBlock {
  kind: "ambiguous";
  citekey: string;
  candidates: readonly AmbiguousCandidate[];
}

export type CitationPopoverBlock =
  | CitationEntryBlock
  | UnresolvedCitationBlock
  | AmbiguousCitationBlock;

export function citationPopoverBlocks(
  works: readonly HoveredWork[],
  entries: readonly ReferenceEntry[],
  {
    serials,
    ambiguous,
  }: { serials: boolean; ambiguous: AmbiguousCandidatesOf },
): CitationPopoverBlock[] {
  const byItem = new Map(entries.map((entry) => [entry.id, entry]));
  return works.map(({ citekey, indexedKey }) => {
    const entry = indexedKey === undefined ? undefined : byItem.get(indexedKey);
    switch (entry?.kind) {
      case "rendered":
        return {
          kind: "entry",
          citekey,
          marker: entry.marker,
          serial: serials ? entry.serial : undefined,
          content: entry.content,
          summary: entry.source.summary,
          itemKey: entry.source.itemKey,
          groupID: entry.source.groupID,
          attachments: entry.source.attachments,
        };
      case "summary":
      case "unrendered":
        return {
          kind: "entry",
          citekey,
          marker: undefined,
          serial: undefined,
          content: null,
          summary: entry.source.summary,
          itemKey: entry.source.itemKey,
          groupID: entry.source.groupID,
          attachments: entry.source.attachments,
        };
      default: {
        const candidates = ambiguous(citekey);
        return candidates === null
          ? { kind: "unresolved", citekey }
          : { kind: "ambiguous", citekey, candidates };
      }
    }
  });
}
