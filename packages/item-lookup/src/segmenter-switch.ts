import { Context, Effect } from "effect";
import type { Layer } from "effect";

import type { PackFailure } from "@zotlit/resource-pack/format.ts";
import type { PackEntryLocation } from "@zotlit/resource-pack/reader.ts";
import { refusalStatus } from "@zotlit/resource-pack/status.ts";
import type { PackBinaryStatus } from "@zotlit/resource-pack/status.ts";
import { withLogCategory } from "@zotlit/shared/logging";

import {
  JIEBA_WASM_VERSION,
  layerSegmenterJieba,
  layerSegmenterNone,
  Segmenter,
} from "./segmenter.ts";

export type SegmenterBinary = PackEntryLocation;

interface SegmenterBinaryBytes {
  readonly bytes: BufferSource;
  readonly upstreamVersion: string | undefined;
}

export type SegmenterStatus = PackBinaryStatus;

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

export class SegmenterBinaryReader extends Context.Service<
  SegmenterBinaryReader,
  {
    readonly read: (
      binary: SegmenterBinary,
    ) => Effect.Effect<SegmenterBinaryBytes, PackFailure>;
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

export function makeSegmenterSwitch(
  reader: (typeof SegmenterBinaryReader)["Service"],
): {
  readonly resolve: (
    next: SegmenterBinary | null,
    options?: { readonly reread?: boolean },
  ) => Effect.Effect<SegmenterService | undefined>;
  readonly status: Effect.Effect<SegmenterStatus>;
} {
  let requested: SegmenterBinary | null = null;
  let jieba = false;
  let loaded: string | null = null;
  let status: SegmenterStatus = { kind: "pack-absent" };

  const toNone = Effect.suspend(() => {
    if (!jieba) return Effect.undefined;
    jieba = false;
    return segmenterOf(layerSegmenterNone);
  });

  const refused = (
    binary: SegmenterBinary,
    next: SegmenterStatus,
    fields: Readonly<Record<string, unknown>>,
  ) =>
    Effect.suspend(() => {
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
        onSuccess: ({ bytes, upstreamVersion }) =>
          Effect.gen(function* () {
            if (
              upstreamVersion !== undefined &&
              upstreamVersion !== JIEBA_WASM_VERSION
            ) {
              const older =
                upstreamVersion.localeCompare(JIEBA_WASM_VERSION, "en", {
                  numeric: true,
                }) < 0;
              return yield* refused(
                binary,
                { kind: older ? "pack-outdated" : "plugin-outdated" },
                { upstreamVersion, bundled: JIEBA_WASM_VERSION },
              );
            }
            if (loaded !== null && loaded !== binary.version) {
              yield* log(
                "warn",
                "The Chinese Segmenter keeps its first binary until the realm restarts",
                { loaded, requested: binary.version },
              );
            }
            const segmenter = jieba
              ? undefined
              : yield* segmenterOf(layerSegmenterJieba(bytes));
            loaded ??= binary.version;
            status = { kind: "ready", version: loaded };
            if (!segmenter) return undefined;
            jieba = true;
            yield* log("info", "The Chinese Segmenter cuts CJK text", {
              pack: loaded,
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
