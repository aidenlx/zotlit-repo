// The Item Index's Chinese Segmenter switch: the binary of the Resource Pack it cuts CJK text with, or `Intl.Segmenter`.
import { Context, Effect } from "effect";
import type { Layer } from "effect";

import type { PackFailure } from "@zotlit/resource-pack/format.ts";
import type { PackEntryLocation } from "@zotlit/resource-pack/reader.ts";
import { refusalStatus } from "@zotlit/resource-pack/status.ts";
import type { PackBinaryStatus } from "@zotlit/resource-pack/status.ts";
import { withLogCategory } from "@zotlit/shared/logging";

import {
  layerSegmenterJieba,
  layerSegmenterNone,
  Segmenter,
} from "./segmenter.ts";

/** The Chinese Segmenter binary of an installed Resource Pack: one Pack Entry of the pack file. */
export type SegmenterBinary = PackEntryLocation;

/**
 * Where the Chinese Segmenter stands in the realm that cuts with it: `ready`
 * while the Item Index cuts CJK text with the binary, and each other arm
 * while it cuts with `Intl.Segmenter`.
 */
export type SegmenterStatus = PackBinaryStatus;

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
    a.version === b.version);

/**
 * Port: reads and verifies the bytes of an installed Chinese Segmenter
 * binary. A pack that gives no binary fails with the reason.
 */
export class SegmenterBinaryReader extends Context.Service<
  SegmenterBinaryReader,
  {
    readonly read: (
      binary: SegmenterBinary,
    ) => Effect.Effect<BufferSource, PackFailure>;
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
 * with that binary tries it again. `reread` reads the binary again whatever
 * `resolve` saw last. The caller applies each answer before the next
 * `resolve`. `status` states where the Segmenter stands after the last
 * `resolve`.
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
    options?: { readonly reread?: boolean },
  ) => Effect.Effect<SegmenterService | undefined>;
  readonly status: Effect.Effect<SegmenterStatus>;
} {
  /** The binary the settings named last. */
  let requested: SegmenterBinary | null = null;
  /** Whether the index cuts with jieba now. */
  let jieba = false;
  /** The pack version of the binary jieba loaded from in this realm. */
  let loaded: string | null = null;
  let status: SegmenterStatus = { kind: "pack-absent" };

  const toNone = Effect.suspend(() => {
    if (!jieba) return Effect.undefined;
    jieba = false;
    return segmenterOf(layerSegmenterNone);
  });

  /** The index cuts with `Intl.Segmenter`, for the reason `next` states. */
  const refused = (
    binary: SegmenterBinary,
    next: SegmenterStatus,
    fields: Readonly<Record<string, unknown>>,
  ) =>
    Effect.suspend(() => {
      // The next `resolve` with the same binary tries it again.
      requested = null;
      status = next;
      return Effect.andThen(
        log(
          "warn",
          "The Chinese Segmenter did not start; CJK text uses Intl.Segmenter",
          { pack: binary.version, reason: next.kind, ...fields },
        ),
        toNone,
      );
    });

  const install = (binary: SegmenterBinary) =>
    reader.read(binary).pipe(
      Effect.matchEffect({
        onFailure: (failure) =>
          refused(binary, refusalStatus(failure), { failure }),
        onSuccess: (bytes) =>
          Effect.gen(function* () {
            if (loaded !== null && loaded !== binary.version) {
              yield* log(
                "warn",
                "The Chinese Segmenter keeps its first binary until the realm restarts",
                { loaded, requested: binary.version },
              );
            }
            status = { kind: "ready", version: binary.version };
            // The index cuts with the one instance of this realm already.
            if (jieba) return undefined;
            const segmenter = yield* segmenterOf(layerSegmenterJieba(bytes));
            loaded ??= binary.version;
            jieba = true;
            yield* log("info", "The Chinese Segmenter cuts CJK text", {
              pack: binary.version,
            });
            return segmenter;
          }).pipe(
            Effect.catchTag("SegmenterUnavailable", (error) =>
              refused(
                binary,
                { kind: "failed", detail: error.message },
                { error: error.message },
              ),
            ),
          ),
      }),
    );

  const resolve = (
    next: SegmenterBinary | null,
    options?: { readonly reread?: boolean },
  ): Effect.Effect<SegmenterService | undefined> =>
    Effect.suspend(() => {
      // A binary that did not load left `requested` empty, so the same
      // location is tried again.
      if (!options?.reread && sameSegmenterBinary(requested, next))
        return Effect.undefined;
      requested = next;
      if (next) return install(next);
      status = { kind: "pack-absent" };
      return Effect.andThen(
        log(
          "info",
          "No Resource Pack holds the Chinese Segmenter; CJK text uses Intl.Segmenter",
        ),
        toNone,
      );
    });

  return { resolve, status: Effect.sync(() => status) };
}

const segmenterOf = <E>(
  layer: Layer.Layer<Segmenter, E>,
): Effect.Effect<SegmenterService, E> =>
  Effect.provide(Effect.service(Segmenter), layer);
