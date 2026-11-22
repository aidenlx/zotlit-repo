import { Effect } from "effect";
import type { TFile } from "obsidian";

import { listInstalledStylesOrNone } from "@zotlit/citations/desktop/pandoc/installed-styles.ts";
import { isChildItemFields } from "@zotlit/db";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { itemSummary } from "@zotlit/plugin-kernel/item-summary.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ItemSnapshot } from "@zotlit/zotero-reads/contract/snapshot/types.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import { getSampleItem } from "#core/editor/selection-data.ts";
import { ItemUnavailable } from "#obsidian/view/errors.ts";

export const readItemSnapshot = Effect.fn("TemplateWorkbench.readSnapshot")(
  function* (parsed: NonNullable<ReturnType<typeof parseIndexedKey>>) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const reads = yield* (yield* ZoteroReads).snapshot;
        return yield* reads.ItemSnapshot({
          selection: {
            key: parsed.key,
            library:
              parsed.groupID === null
                ? { type: "personal" }
                : { type: "group", groupID: parsed.groupID },
          },
          provenance: {
            kind: "connected",
            installationId: "obsidian",
            vault: "preview",
          },
        });
      }),
    );
  },
);

export interface ChosenItem {
  readonly title: string | null;
  readonly snapshot: ItemSnapshot;
}

export const readChosenItem = Effect.fn("TemplateWorkbench.readChosenItem")(
  function* (indexedKey: string) {
    const sample = getSampleItem(indexedKey);
    if (sample) return { title: sample.item.title ?? null, snapshot: sample };
    const parsed = parseIndexedKey(indexedKey);
    if (!parsed)
      return yield* new ItemUnavailable({ indexedKey, reason: "missing" });
    const db = yield* ZoteroReads;
    if ((yield* db.current).state === "degraded")
      return yield* new ItemUnavailable({ indexedKey, reason: "degraded" });
    const items = yield* db.reads.ItemsByIndexedKeys({
      indexedKeys: [indexedKey],
    });
    const item = items.get(indexedKey);
    if (!item)
      return yield* new ItemUnavailable({ indexedKey, reason: "missing" });
    if (isChildItemFields(item.fields))
      return yield* new ItemUnavailable({ indexedKey, reason: "child" });
    const snapshot: ItemSnapshot = yield* readItemSnapshot(parsed);
    return {
      title: itemSummary(item, item.fields).formatted,
      snapshot,
    } satisfies ChosenItem;
  },
);

export const builtInSource = Effect.gen(function* () {
  return yield* (yield* Profile).getBuiltInSource;
});

export const profileOfFile = Effect.fn("TemplateWorkbench.profileOf")(
  function* (file: TFile) {
    return yield* (yield* Profile).profileOf(file);
  },
);

export const materializeDefault = Effect.gen(function* () {
  return yield* (yield* Profile).materializeDefault;
});

export const installedStyles = Effect.gen(function* () {
  const { dataDir } = yield* (yield* ZoteroPref).current;
  return dataDir ? yield* listInstalledStylesOrNone(dataDir) : [];
});
