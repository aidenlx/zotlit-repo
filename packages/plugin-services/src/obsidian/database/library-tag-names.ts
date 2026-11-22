import { Cause, Effect } from "effect";

import { resolveIndexedKeyLibraryIn } from "@zotlit/db";
import { valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

export const libraryTagNames = (
  reads: Pick<ZoteroReads["Service"], "current" | "snapshot">,
  annotationKey: string,
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    if ((yield* reads.current).state === "degraded") return [];
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* reads.snapshot;
        const library = resolveIndexedKeyLibraryIn(
          yield* snapshot.Libraries({}),
          annotationKey,
        );
        return library
          ? yield* snapshot.TagNames({ libraryID: library.libraryID })
          : [];
      }),
    );
  }).pipe(
    recover(
      (cause) =>
        Effect.logWarning("Failed to read a library's tag names").pipe(
          Effect.annotateLogs({ annotationKey, error: Cause.squash(cause) }),
          withLogCategory("database", "library-tag-names"),
        ),
      Effect.succeed<readonly string[]>([]),
    ),
  );

export function libraryTagNamesOf(
  reads: Pick<ZoteroReads["Service"], "current" | "snapshot">,
  bridge: Pick<EffectBridge, "runPromiseExit">,
): (annotationKey: string) => Promise<readonly string[]> {
  return async (annotationKey) =>
    valueOr(
      await bridge.runPromiseExit(libraryTagNames(reads, annotationKey)),
      [],
    );
}
