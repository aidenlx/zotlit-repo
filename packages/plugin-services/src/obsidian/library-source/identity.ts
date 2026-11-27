import { Effect, Option } from "effect";

import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { SourceIdentity } from "@zotlit/zotero-reads/contract/source-identity.ts";

import { LibrarySource } from "./service.ts";

import { ZoteroPref } from "#core/zotero-pref/service.ts";

const fileSourceFromPrefs = Effect.gen(function* () {
  const source = yield* Effect.serviceOption(LibrarySource);
  if (Option.isSome(source) && source.value.active !== "file") return null;
  const pref = yield* Effect.serviceOption(ZoteroPref);
  if (Option.isNone(pref)) return null;
  const { sourceId, databasePath } = yield* pref.value.current;
  return { kind: "file" as const, id: sourceId, databasePath };
});

export const readSourceIdentity: Effect.Effect<
  SourceIdentity | null,
  never,
  ZoteroReads
> = Effect.gen(function* () {
  return yield* (yield* ZoteroReads).reads
    .SourceIdentity({})
    .pipe(Effect.catch(() => fileSourceFromPrefs));
});
