// The Item Index's Chinese Segmenter switch: the binary of the Resource Pack it cuts CJK text with, or `Intl.Segmenter`.
import { Context, Effect } from "effect";
import type { Layer } from "effect";

import type { PackEntryLocation } from "@zotlit/resource-pack/reader.ts";
import { withLogCategory } from "@zotlit/shared/logging";

import {
  layerSegmenterJieba,
  layerSegmenterNone,
  Segmenter,
} from "./segmenter.ts";
import type { SegmenterUnavailable } from "./segmenter.ts";

/** The Chinese Segmenter binary of an installed Resource Pack: one Pack Entry of the pack file. */
export type SegmenterBinary = PackEntryLocation;

/** Whether `a` and `b` name the same binary, or both name none. */
export const sameSegmenterBinary = (
  a: SegmenterBinary | null,
  b: SegmenterBinary | null,
): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.url === b.url &&
    a.entry === b.entry &&
    a.version === b.version &&
    a.sha256 === b.sha256);

/**
 * Whether `next` names the binary that `held` loaded from: the same entry of
 * the same pack, where a hash that one side does not know yet matches. The
 * renderer learns the hash at its first read of the pack, after the worker
 * read the same file.
 */
const sameLoadedBinary = (
  held: SegmenterBinary | null,
  next: SegmenterBinary | null,
): boolean =>
  held === next ||
  (held !== null &&
    next !== null &&
    held.url === next.url &&
    held.entry === next.entry &&
    held.version === next.version &&
    (held.sha256 === null ||
      next.sha256 === null ||
      held.sha256 === next.sha256));

/** Port: reads the bytes of an installed Chinese Segmenter binary. */
export class SegmenterBinaryReader extends Context.Service<
  SegmenterBinaryReader,
  {
    readonly read: (
      binary: SegmenterBinary,
    ) => Effect.Effect<BufferSource, SegmenterUnavailable>;
  }
>()("zotlit/item-lookup/SegmenterBinaryReader") {}

const log = (
  level: "info" | "warn",
  message: string,
  properties?: Readonly<Record<string, unknown>>,
) =>
  (level === "warn"
    ? Effect.logWarning(message)
    : Effect.logInfo(message)
  ).pipe(
    Effect.annotateLogs(properties ?? {}),
    withLogCategory("zotlit", "item-lookup", "segmenter"),
  );

type SegmenterService = (typeof Segmenter)["Service"];

/**
 * The Item Index's Segmenter, driven by the installed binary the settings
 * name. `resolve` answers the Segmenter to switch to, and `undefined` when the
 * index keeps its own, so a change of another setting rebuilds no index. A
 * binary that cannot be read or does not start logs a warning and leaves the
 * index on `Intl.Segmenter`; search keeps answering, and the next `resolve`
 * with that binary tries it again. The caller applies each answer before the
 * next `resolve`.
 *
 * `jieba-wasm` holds one instance per realm: a removed pack stops its use but
 * keeps its memory, and the binary of a later pack runs on the bytes that
 * loaded first until the realm restarts.
 */
export function makeSegmenterSwitch(
  reader: (typeof SegmenterBinaryReader)["Service"],
): {
  readonly resolve: (
    next: SegmenterBinary | null,
  ) => Effect.Effect<SegmenterService | undefined>;
} {
  /** The binary the settings named last. */
  let requested: SegmenterBinary | null = null;
  /** Whether the index cuts with jieba now. */
  let jieba = false;
  /** The binary jieba loaded from in this realm. */
  let loaded: SegmenterBinary | null = null;

  const toNone = Effect.suspend(() => {
    if (!jieba) return Effect.undefined;
    jieba = false;
    return segmenterOf(layerSegmenterNone);
  });

  const install = (binary: SegmenterBinary) =>
    reader.read(binary).pipe(
      Effect.flatMap((bytes) => segmenterOf(layerSegmenterJieba(bytes))),
      Effect.tap(() =>
        Effect.gen(function* () {
          if (loaded && !sameLoadedBinary(loaded, binary)) {
            yield* log(
              "warn",
              "The Chinese Segmenter keeps its first binary until the realm restarts",
              { loaded: loaded.version, requested: binary.version },
            );
          }
          loaded ??= binary;
          jieba = true;
          yield* log("info", "The Chinese Segmenter cuts CJK text", {
            pack: binary.version,
          });
        }),
      ),
      Effect.catchTag("SegmenterUnavailable", (error) =>
        Effect.andThen(
          Effect.gen(function* () {
            // The next `resolve` with the same binary tries it again.
            requested = null;
            yield* log(
              "warn",
              "The Chinese Segmenter did not start; CJK text uses Intl.Segmenter",
              { pack: binary.version, error: error.message },
            );
          }),
          toNone,
        ),
      ),
    );

  const resolve = (
    next: SegmenterBinary | null,
  ): Effect.Effect<SegmenterService | undefined> =>
    Effect.suspend(() => {
      // A binary that did not load left `requested` empty, so the same
      // location, or its repaired entry, is tried again.
      if (sameLoadedBinary(requested, next)) {
        requested = next;
        return Effect.undefined;
      }
      requested = next;
      if (next) return install(next);
      return Effect.andThen(
        log(
          "info",
          "No Resource Pack holds the Chinese Segmenter; CJK text uses Intl.Segmenter",
        ),
        toNone,
      );
    });

  return { resolve };
}

const segmenterOf = <E>(
  layer: Layer.Layer<Segmenter, E>,
): Effect.Effect<SegmenterService, E> =>
  Effect.provide(Effect.service(Segmenter), layer);
