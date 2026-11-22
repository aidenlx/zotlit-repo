import type {
  NoteProfile,
  ResolvedProfile,
} from "#obsidian/profile/bindings.ts";
import { Effect } from "effect";

import type { Item } from "@zotlit/db";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import { Template } from "#obsidian/template/service.ts";

function relocationSource(current: NoteProfile): ResolvedProfile | undefined {
  return current.ok ? current.profile : undefined;
}

function readItem(reads: ZoteroReadsApi, indexedKey: string) {
  return reads
    .ItemsByIndexedKeys({ indexedKeys: [indexedKey] })
    .pipe(Effect.map((items): Item | undefined => items.get(indexedKey)));
}

const resolveProfileDocument = Effect.fnUntraced(function* (
  profile: ResolvedProfile,
) {
  if (profile.document === undefined) return undefined;
  const template = yield* Template;
  return (yield* template.getLiteratureNoteTemplate(profile.document)) ?? null;
});

export { readItem, relocationSource, resolveProfileDocument };
