import { Effect, Option, Result, Stream } from "effect";
import type { ObsidianProtocolData } from "obsidian";

import type { ItemRef } from "@zotlit/db";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { protocolSourceMatches } from "@zotlit/protocol";
import { readDisplayRef } from "@zotlit/zotero-reads/client/display-ref.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { LinkOutcome, refuse } from "./outcome.ts";

import { ZoteroPref } from "#core/zotero-pref/service.ts";

export function parseProtocolData<Query extends { sourceId: string }>(
  data: ObsidianProtocolData,
  options: {
    action: string;
    parse: (data: Record<string, unknown>) => Query;
  },
): Effect.Effect<Result.Result<Query, LinkOutcome>, never, ZoteroPref> {
  const { action, parse } = options;
  return Effect.gen(function* () {
    const parsed = yield* Effect.try(() => parse(data)).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Invalid protocol query").pipe(
          Effect.annotateLogs({ action, error: error.cause }),
          Effect.as(null),
        ),
      ),
    );
    if (!parsed) return refuse(LinkOutcome.InvalidLink());

    const { acceptedSourceIds } = yield* (yield* ZoteroPref).current;
    if (!protocolSourceMatches(parsed, acceptedSourceIds)) {
      yield* Effect.logWarning("Protocol source id mismatch").pipe(
        Effect.annotateLogs({
          action,
          received: parsed.sourceId,
          expected: acceptedSourceIds,
        }),
      );
      return refuse(LinkOutcome.ForeignSource());
    }

    return Result.succeed(parsed);
  }).pipe(withLogCategory("protocol"));
}

export const databaseReady = Effect.fn("protocol.databaseReady")(function* (
  zoteroReads: Pick<ZoteroReads["Service"], "changes">,
  action: string,
) {
  const settled = yield* Stream.runHead(
    Stream.filter(zoteroReads.changes, (state) => state.state !== "loading"),
  );
  if (Option.isSome(settled) && settled.value.state === "ready") return true;
  yield* Effect.logWarning("Protocol handler: database not ready").pipe(
    Effect.annotateLogs({ action }),
    withLogCategory("protocol"),
  );
  return false;
});

export const resolveProtocolItem = Effect.fn("protocol.resolveProtocolItem")(
  function* (query: { item: number }, action: string) {
    const zoteroReads = yield* ZoteroReads;
    if (!(yield* databaseReady(zoteroReads, action)))
      return refuse(LinkOutcome.DatabaseUnavailable());

    const ref = yield* readDisplayRef(zoteroReads.reads, query.item);
    if (!ref) {
      yield* Effect.logWarning("Protocol handler: item not found").pipe(
        Effect.annotateLogs({ action, itemID: query.item }),
        withLogCategory("protocol"),
      );
      return refuse(LinkOutcome.ItemNotFound());
    }

    const { itemID, libraryID, key, groupID, indexedKey } = ref;
    const item: ItemRef = { itemID, libraryID, key, groupID, indexedKey };
    return Result.succeed(item);
  },
);
