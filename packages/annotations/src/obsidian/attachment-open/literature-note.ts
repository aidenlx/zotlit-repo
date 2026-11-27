import type { OpenablePdfs } from "#core/attachment-open/openable.ts";
import { Effect } from "effect";

import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { libraryFilePaths } from "@zotlit/plugin-services/obsidian/library-source/paths.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import {
  NO_OPENABLE_PDFS,
  toObsidianOpenable,
} from "#core/attachment-open/openable.ts";

export type LiteratureNoteServices =
  | ZoteroReads
  | ZoteroPref
  | ObsidianEnv
  | VaultDisk;

export function literatureNoteAttachments(
  indexedKey: string,
): Effect.Effect<OpenablePdfs, never, LiteratureNoteServices> {
  return Effect.gen(function* () {
    const reads = yield* (yield* ZoteroReads).snapshot;
    const items = yield* reads.ItemsByIndexedKeys({
      indexedKeys: [indexedKey],
    });
    const itemID = items.get(indexedKey)?.itemID;
    if (itemID === undefined) return NO_OPENABLE_PDFS;
    const attachments = yield* reads.AttachmentsOf({ itemIDs: [itemID] });
    return toObsidianOpenable(attachments, {
      vaultBasePath: (yield* VaultDisk).basePath,
      platform: (yield* ObsidianEnv).os,
      zoteroPref: yield* libraryFilePaths,
    });
  }).pipe(
    Effect.scoped,
    recover(
      (cause) =>
        Effect.logWarning(
          "Literature Note Attachments unavailable",
          cause,
        ).pipe(Effect.annotateLogs({ indexedKey })),
      Effect.succeed(NO_OPENABLE_PDFS),
    ),
    withLogCategory("attachment-open"),
  );
}
