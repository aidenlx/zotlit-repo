import type { Effect, Stream } from "effect";
import { Data } from "effect";

export class ExportFileError extends Data.TaggedError("ExportFileError")<{
  readonly message: string;
}> {}

export interface ExportFiles {
  readonly write: <E, R>(
    path: string,
    document: Stream.Stream<Uint8Array, E, R>,
  ) => Effect.Effect<number, E | ExportFileError, R>;
}
