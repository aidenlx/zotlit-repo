import { Effect } from "effect";

import { isChildItemFields, itemToCsl } from "@zotlit/db";
import type { Attachment, CslItemData, Item } from "@zotlit/db";
import { parseAttachmentPath } from "@zotlit/db/path";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { itemSummary } from "@zotlit/plugin-kernel/item-summary.ts";
import type { ZoteroOpenableAttachment } from "@zotlit/plugin-services/core/attachment-resolver/zotero-openable.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import type { Citation } from "./query.ts";

export type DatabaseReadability = "ready" | "unreadable";

export interface ReferenceSourceJoin {
  presentKeys: ReadonlySet<string>;
  sources: Map<string, ReferenceSource>;
  database: DatabaseReadability;
}

export interface ReferenceSource {
  csl: CslItemData;
  summary: string;
  citationSummary: string;
  itemKey: string;
  itemID: number;
  groupID: number | null;
  citekey: string | null;
  linkpath: string | null;
  attachments: readonly ZoteroOpenableAttachment[];
}

export function toZoteroOpenableAttachments(
  attachments: readonly Attachment[],
): ZoteroOpenableAttachment[] {
  const openable: ZoteroOpenableAttachment[] = [];
  for (const { key, groupID, path, linkMode } of attachments) {
    const parsed = parseAttachmentPath(path, linkMode, key);
    switch (parsed.kind) {
      case "storage":
        openable.push({ key, groupID, label: parsed.filename });
        break;
      case "linked-absolute":
        openable.push({ key, groupID, label: filename(parsed.path) });
        break;
      case "linked-base":
        openable.push({ key, groupID, label: filename(parsed.relative) });
        break;
      case "linked-url":
      case "unknown":
        break;
    }
  }
  return openable;
}

function filename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export const readReferenceSources = Effect.fn("readReferenceSources")(
  function* (
    db: Pick<ZoteroReads["Service"], "current" | "snapshot">,
    citations: readonly Pick<Citation, "indexedKey" | "linkpath">[],
  ): Effect.fn.Return<ReferenceSourceJoin> {
    const sources = new Map<string, ReferenceSource>();
    const presentKeys = new Set<string>();
    if ((yield* db.current).state === "degraded")
      return { sources, presentKeys, database: "unreadable" };
    if (citations.length === 0)
      return { sources, presentKeys, database: "ready" };

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const reads = yield* db.snapshot;
        const indexedKeys = [
          ...new Set(
            citations.flatMap(({ indexedKey }) =>
              indexedKey === null ? [] : [indexedKey],
            ),
          ),
        ];
        const [user, items] = yield* Effect.all(
          [
            reads.DatabaseIdentity({}),
            reads.ItemsByIndexedKeys({ indexedKeys }),
          ],
          { concurrency: "unbounded" },
        );
        for (const key of items.keys()) presentKeys.add(key);
        const otherItems = yield* Effect.forEach(
          indexedKeys.filter((key) => !items.has(key)),
          (indexedKey) =>
            Effect.map(reads.ItemType({ indexedKey }), (item) =>
              item ? indexedKey : null,
            ),
          { concurrency: "unbounded" },
        );
        for (const key of otherItems) if (key !== null) presentKeys.add(key);
        const cited: {
          indexedKey: string;
          linkpath: string | null;
          item: Item;
          summary: string;
          citationSummary: string;
          citekey: string | null;
        }[] = [];
        for (const { indexedKey, linkpath } of citations) {
          if (indexedKey === null) continue;
          const item = items.get(indexedKey);
          if (!item) continue;
          const { fields } = item;
          if (isChildItemFields(fields)) continue;
          const summary = itemSummary(item, fields);
          cited.push({
            indexedKey,
            linkpath,
            item,
            summary: summary.formatted,
            citationSummary: summary.subtitle || summary.title,
            citekey: fields.citationKey ?? null,
          });
        }

        const attachments = new Map<number, ZoteroOpenableAttachment[]>();
        const rows = yield* reads
          .AttachmentsOf({ itemIDs: cited.map(({ item }) => item.itemID) })
          .pipe(
            recover(
              (cause) =>
                Effect.logWarning(
                  "Cannot read the attachments of the cited items",
                  cause,
                ),
              Effect.succeed([]),
            ),
          );
        for (const [itemID, group] of Map.groupBy(
          rows,
          (row) => row.parentItemID,
        )) {
          attachments.set(itemID, toZoteroOpenableAttachments(group));
        }

        for (const {
          indexedKey,
          linkpath,
          item,
          summary,
          citationSummary,
          citekey,
        } of cited) {
          sources.set(indexedKey, {
            csl: itemToCsl(item, user),
            summary,
            citationSummary,
            itemKey: item.key,
            itemID: item.itemID,
            groupID: item.groupID,
            citekey,
            linkpath,
            attachments: attachments.get(item.itemID) ?? [],
          });
        }
        return { sources, presentKeys, database: "ready" as const };
      }),
    ).pipe(
      recover(
        (cause) => Effect.logWarning("Cannot read the cited items", cause),
        Effect.succeed({
          sources,
          presentKeys,
          database: "unreadable" as const,
        }),
      ),
      withLogCategory("citation-index"),
    );
  },
);
