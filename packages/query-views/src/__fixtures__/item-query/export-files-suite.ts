import { it } from "@effect/vitest";
import { Cause, Data, Deferred, Effect, Exit, Fiber, Stream } from "effect";
import type { Scope } from "effect";
import { describe, expect } from "vitest";

import { ExportFileError } from "#core/item-query/export-files.ts";
import type { ExportFiles } from "#core/item-query/export-files.ts";

export interface ExportFolder {
  readonly path: (name: string) => string;
  readonly missing: (name: string) => string;
  readonly names: Effect.Effect<readonly string[]>;
  readonly read: (name: string) => Effect.Effect<Uint8Array>;
  readonly put: (name: string, bytes: Uint8Array) => Effect.Effect<void>;
}

export interface ExportFilesHarness {
  readonly files: Effect.Effect<ExportFiles>;
  readonly folder: Effect.Effect<ExportFolder, never, Scope.Scope>;
}

class DocumentFailed extends Data.TaggedError("DocumentFailed") {}

const encoder = new TextEncoder();
const NAME = "answer.json";

function splitDocument(): Uint8Array[] {
  const text = encoder.encode('[{"title":"Écrits"},{"title":"論文 📚"}]');
  return [text.slice(0, 13), text.slice(13, 27), text.slice(27)];
}

function joined(chunks: readonly Uint8Array[]): Uint8Array {
  const all = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return all;
}

export function describeExportFilesContract(
  name: string,
  harness: ExportFilesHarness,
): void {
  describe(`export files contract: ${name}`, () => {
    it.effect("writes the exact bytes of the document and resolves their count", () =>
      Effect.gen(function* () {
        const files = yield* harness.files;
        const folder = yield* harness.folder;
        const chunks = splitDocument();
        const bytes = yield* files.write(
          folder.path(NAME),
          Stream.fromIterable(chunks),
        );
        expect(yield* folder.read(NAME)).toEqual(joined(chunks));
        expect(bytes).toBe(joined(chunks).byteLength);
        expect(yield* folder.names).toEqual([NAME]);
      }),
    );

    it.effect("keeps an existing file and fails", () =>
      Effect.gen(function* () {
        const files = yield* harness.files;
        const folder = yield* harness.folder;
        const before = encoder.encode("the researcher's file");
        yield* folder.put(NAME, before);
        const error = yield* Effect.flip(
          files.write(folder.path(NAME), Stream.fromIterable(splitDocument())),
        );
        expect(error).toBeInstanceOf(ExportFileError);
        expect(yield* folder.read(NAME)).toEqual(before);
        expect(yield* folder.names).toEqual([NAME]);
      }),
    );

    it.effect("leaves no file after the document fails", () =>
      Effect.gen(function* () {
        const files = yield* harness.files;
        const folder = yield* harness.folder;
        const document = Stream.fromIterable(splitDocument()).pipe(
          Stream.concat(Stream.fail(new DocumentFailed())),
        );
        const error = yield* Effect.flip(
          files.write(folder.path(NAME), document),
        );
        expect(error).toBeInstanceOf(DocumentFailed);
        expect(yield* folder.names).toEqual([]);
      }),
    );

    it.effect("leaves no file after an interrupt", () =>
      Effect.gen(function* () {
        const files = yield* harness.files;
        const folder = yield* harness.folder;
        const written = yield* Deferred.make<void>();
        const document = Stream.fromIterable(splitDocument()).pipe(
          Stream.concat(
            Stream.fromEffect(
              Deferred.succeed(written, undefined).pipe(
                Effect.andThen(Effect.never),
              ),
            ),
          ),
        );
        const fiber = yield* Effect.forkChild(
          files.write(folder.path(NAME), document),
        );
        yield* Deferred.await(written);
        const exit = yield* Fiber.interrupt(fiber).pipe(
          Effect.andThen(Fiber.await(fiber)),
        );
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
          true,
        );
        expect(yield* folder.names).toEqual([]);
      }),
    );

    it.effect("fails with the error of a document that fails before its first chunk", () =>
      Effect.gen(function* () {
        const files = yield* harness.files;
        const folder = yield* harness.folder;
        const error = yield* Effect.flip(
          files.write(folder.missing(NAME), Stream.fail(new DocumentFailed())),
        );
        expect(error).toBeInstanceOf(DocumentFailed);
        expect(yield* folder.names).toEqual([]);
      }),
    );

    it.effect("fails and writes nothing for a folder that does not exist", () =>
      Effect.gen(function* () {
        const files = yield* harness.files;
        const folder = yield* harness.folder;
        const error = yield* Effect.flip(
          files.write(
            folder.missing(NAME),
            Stream.fromIterable(splitDocument()),
          ),
        );
        expect(error).toBeInstanceOf(ExportFileError);
        expect(yield* folder.names).toEqual([]);
      }),
    );

    it.effect("takes a document with no chunk as a defect", () =>
      Effect.gen(function* () {
        const files = yield* harness.files;
        const folder = yield* harness.folder;
        const exit = yield* Effect.exit(
          files.write(folder.path(NAME), Stream.empty),
        );
        expect(Exit.hasDies(exit)).toBe(true);
        expect(yield* folder.names).toEqual([]);
      }),
    );
  });
}
