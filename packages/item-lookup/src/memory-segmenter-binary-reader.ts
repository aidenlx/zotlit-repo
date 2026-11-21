// An in-memory SegmenterBinaryReader with the controls an Item Index test drives.
import { Effect, Layer } from "effect";

import { makeGate } from "./make-gate.ts";
import { SegmenterBinaryReader } from "./segmenter-switch.ts";
import type { SegmenterBinary } from "./segmenter-switch.ts";

/**
 * A {@link SegmenterBinaryReader} that answers the bytes `bytesFor` names,
 * with controls for a test: count the reads and hold them at a gate.
 */
export interface MemorySegmenterBinaryReader {
  readonly layer: Layer.Layer<SegmenterBinaryReader>;
  /** The binaries read so far, in read order. */
  readonly asked: readonly SegmenterBinary[];
  /** Hold every later read until {@link MemorySegmenterBinaryReader.openGate}. */
  readonly closeGate: Effect.Effect<void>;
  readonly openGate: Effect.Effect<void>;
  /** Wait until a read is held at the closed gate. */
  readonly held: Effect.Effect<void>;
}

/**
 * `bytesFor` answers the bytes of a binary; `undefined` reads as a pack that
 * lacks the entry.
 */
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
                : Effect.succeed(bytes);
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
