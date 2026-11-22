import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import { Effect } from "effect";

import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { toObsidianOpenable } from "#core/attachment-open/openable.ts";

export type LiteratureNoteServices = ZoteroReads | ZoteroPref | ObsidianEnv;

export function literatureNoteAttachments(
  indexedKey: string,
): Effect.Effect<ObsidianOpenableAttachment[], never, LiteratureNoteServices> {
  return Effect.gen(function* () {
    const reads = yield* (yield* ZoteroReads).snapshot;
    const items = yield* reads.ItemsByIndexedKeys({
      indexedKeys: [indexedKey],
    });
    const itemID = items.get(indexedKey)?.itemID;
    if (itemID === undefined) return [];
    const attachments = yield* reads.AttachmentsOf({ itemIDs: [itemID] });
    return toObsidianOpenable(attachments, {
      vaultBasePath: (yield* ObsidianEnv).basePath,
      zoteroPref: yield* (yield* ZoteroPref).current,
    });
  }).pipe(
    Effect.scoped,
    recover(
      (cause) =>
        Effect.logWarning(
          "Literature Note Attachments unavailable",
          cause,
        ).pipe(Effect.annotateLogs({ indexedKey })),
      Effect.succeed([]),
    ),
    withLogCategory("attachment-open"),
  );
}
