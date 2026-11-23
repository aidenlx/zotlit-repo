import { Effect, Layer } from "effect";

import { makeGate } from "./make-gate.ts";
import { SegmenterBinaryReader } from "./segmenter-switch.ts";
import type { SegmenterBinary } from "./segmenter-switch.ts";

export interface MemorySegmenterBinaryReader {
  readonly layer: Layer.Layer<SegmenterBinaryReader>;
  readonly asked: readonly SegmenterBinary[];
  readonly closeGate: Effect.Effect<void>;
  readonly openGate: Effect.Effect<void>;
  readonly held: Effect.Effect<void>;
}

export const makeMemorySegmenterBinaryReader = (
  bytesFor: (binary: SegmenterBinary) => BufferSource | undefined,
): Effect.Effect<MemorySegmenterBinaryReader> =>
  Effect.gen(function* () {
    const asked: SegmenterBinary[] = [];
    const gate = yield* makeGate();

    const layer = Layer.succeed(SegmenterBinaryReader, {
      read: (binary) =>
        Effect.suspend(() => {
          asked.push(binary);
          return gate.pass;
        }).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              const bytes = bytesFor(binary);
              return bytes === undefined
                ? Effect.fail({
                    kind: "entry-missing",
                    name: binary.entry,
                  } as const)
                : Effect.succeed({ bytes, upstreamVersion: undefined });
            }),
          ),
        ),
    });

    return {
      layer,
      asked,
      closeGate: gate.close,
      openGate: gate.open,
      held: gate.held,
    } satisfies MemorySegmenterBinaryReader;
  });
