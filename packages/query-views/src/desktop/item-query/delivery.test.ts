import type { ExportFiles } from "#core/item-query/export-files.ts";
import type {
  QueryObserver,
  WorkerMeasurement,
} from "#worker/item-query/trace.ts";
import { it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Stream } from "effect";
import { describe, expect } from "vitest";

import type { QueryAnswerPart } from "@zotlit/zotero-reads/contract/rpc.ts";
import { QueryFailed } from "@zotlit/zotero-reads/contract/rpc.ts";

import type { AnswerTarget } from "./delivery.ts";
import {
  deliverAnswer,
  DeliveryFailure,
  INLINE_MAX_BYTES,
} from "./delivery.ts";

import { ExportFileError } from "#core/item-query/export-files.ts";
import {
  diagnostic,
  fileReceipt,
  QUERY_COMMAND,
} from "#worker/item-query/contract.ts";

const bytesOf = (text: string) => new TextEncoder().encode(text);
const BOM = String.fromCharCode(0xfeff);
const CHUNK = 256 * 1024;

const SUMMARY = {
  ok: true as const,
  identity: {
    vault: { name: "Research", path: "/vaults/research" },
    source: {
      kind: "file" as const,
      id: "source-1",
      databasePath: "/zotero/zotero.sqlite",
    },
  },
};
const MEASUREMENT: WorkerMeasurement = {
  workerMs: 1,
  answerSteps: [],
  slices: [],
  pauses: 0,
  longestPauseMs: 0,
  statements: {},
};
const head: QueryAnswerPart = { _tag: "Head", summary: SUMMARY };
const trace: QueryAnswerPart = { _tag: "Trace", measurement: MEASUREMENT };
const chunk = (bytes: Uint8Array<ArrayBuffer>): QueryAnswerPart => ({
  _tag: "Chunk",
  bytes,
});
const answerOf = (...chunks: readonly Uint8Array<ArrayBuffer>[]) =>
  Stream.make(head, ...chunks.map(chunk));

const FILE: AnswerTarget = {
  kind: "file",
  path: "/exports/items.csv",
  format: "csv",
};

const deliver = <E>(
  answer: Stream.Stream<QueryAnswerPart, E>,
  options: {
    target?: AnswerTarget;
    files?: ExportFiles;
    observer?: QueryObserver;
  } = {},
) =>
  deliverAnswer({
    command: QUERY_COMMAND,
    target: options.target ?? { kind: "inline" },
    answer,
    files: options.files,
    observer: options.observer,
  });

const observed = () => {
  const measurements: WorkerMeasurement[] = [];
  return {
    measurements,
    observer: {
      completed: (measurement) => measurements.push(measurement),
    } satisfies QueryObserver,
  };
};

const counted = (count: number) => {
  let read = 0;
  return {
    read: () => read,
    answer: Stream.concat(
      Stream.make(head),
      Stream.range(1, count).pipe(
        Stream.rechunk(1),
        Stream.map(() => {
          read++;
          return chunk(new Uint8Array(CHUNK).fill(0x61));
        }),
      ),
    ),
  };
};

const forkJob = <A, E>(delivery: Effect.Effect<A, E>) =>
  Effect.forkChild(delivery, { uninterruptible: true });

const collecting = () => {
  const written: string[] = [];
  const files: ExportFiles = {
    write: (path, document) =>
      Stream.runFold(
        document,
        () => 0,
        (bytes, part) => {
          written.push(path, new TextDecoder().decode(part));
          return bytes + part.byteLength;
        },
      ),
  };
  return { written, files };
};

describe("inline delivery", () => {
  it.effect(
    "decodes a multi-byte character that is split between two chunks",
    () =>
      Effect.gen(function* () {
        const euro = bytesOf("a€b");
        expect(
          yield* deliver(
            answerOf(euro.slice(0, 2), euro.slice(2, 3), euro.slice(3)),
          ),
        ).toBe("a€b");
      }),
  );

  it.effect("keeps a leading byte order mark of the document", () =>
    Effect.gen(function* () {
      expect(yield* deliver(answerOf(bytesOf(`${BOM}{}`)))).toBe(`${BOM}{}`);
    }),
  );

  it.effect(
    "refuses a document above the limit and stops reading it there",
    () =>
      Effect.gen(function* () {
        const { read, answer } = counted(100);
        expect(yield* Effect.flip(deliver(answer))).toEqual(
          new DeliveryFailure({
            code: "result-too-large",
            message: `The JSON response exceeds the inline limit of ${INLINE_MAX_BYTES} bytes.`,
          }),
        );
        expect(read()).toBe(INLINE_MAX_BYTES / CHUNK + 1);
      }),
  );

  it.effect(
    "reads the rest of a measured document above the limit, and gives its Worker measurement",
    () =>
      Effect.gen(function* () {
        const { read, answer } = counted(100);
        const { measurements, observer } = observed();
        const failed = yield* Effect.flip(
          deliver(Stream.concat(answer, Stream.make(trace)), { observer }),
        );
        expect(failed).toMatchObject({ code: "result-too-large" });
        expect(read()).toBe(100);
        expect(measurements).toEqual([MEASUREMENT]);
      }),
  );

  it.effect("gives the failure of the document as its own", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(
          deliver(
            Stream.concat(answerOf(bytesOf("{")), Stream.fail("query failed")),
          ),
        ),
      ).toBe("query failed");
    }),
  );

  const limit = INLINE_MAX_BYTES;
  it.effect.each<[string, string, boolean]>([
    ["ASCII at the limit", "a".repeat(limit), false],
    ["ASCII one byte above", "a".repeat(limit + 1), true],
    [
      "3-byte characters at the limit",
      "€".repeat(Math.floor(limit / 3)),
      false,
    ],
    [
      "3-byte characters one above, fewer characters than the limit",
      "€".repeat(Math.floor(limit / 3) + 1),
      true,
    ],
    ["astral characters at the limit", "😀".repeat(limit / 4), false],
    ["astral characters one above", "😀".repeat(limit / 4 + 1), true],
  ])("bounds the UTF-8 bytes: %s", ([, text, exceeds]) =>
    Effect.gen(function* () {
      const bytes = bytesOf(text);
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      for (let at = 0; at < bytes.byteLength; at += 100_000)
        chunks.push(bytes.slice(at, at + 100_000));
      const delivered = yield* Effect.result(deliver(answerOf(...chunks)));
      expect(Buffer.byteLength(text) > limit).toBe(exceeds);
      expect(delivered._tag === "Failure").toBe(exceeds);
      if (delivered._tag === "Success") expect(delivered.success).toBe(text);
    }),
  );
});

describe("the answer stream", () => {
  it.effect("reads the head, the chunks and the trace in their order", () =>
    Effect.gen(function* () {
      const { measurements, observer } = observed();
      expect(
        yield* deliver(
          Stream.make(head, chunk(bytesOf("{")), chunk(bytesOf("}")), trace),
          { observer },
        ),
      ).toBe("{}");
      expect(measurements).toEqual([MEASUREMENT]);
      expect(yield* deliver(Stream.make(head), { observer })).toBe("");
      expect(measurements).toEqual([MEASUREMENT]);
    }),
  );

  it.effect.each([
    ["no head", [chunk(bytesOf("{}"))]],
    ["no part", []],
    ["a second head", [head, head]],
    ["a chunk after the trace", [head, trace, chunk(bytesOf("{}"))]],
  ] as const)("dies on a stream with %s", ([, parts]) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(deliver(Stream.fromIterable(parts)));
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }),
  );

  it.effect(
    "gives the Worker measurement of a query that fails, and its failure",
    () =>
      Effect.gen(function* () {
        const { measurements, observer } = observed();
        const failure = new QueryFailed({
          diagnostic: diagnostic("database-error", "The query failed."),
          measurement: MEASUREMENT,
        });
        expect(
          yield* Effect.flip(deliver(Stream.fail(failure), { observer })),
        ).toBe(failure);
        expect(measurements).toEqual([MEASUREMENT]);
      }),
  );
});

describe("file delivery", () => {
  it.effect(
    "answers export-unavailable with no file port, and starts no answer stream",
    () =>
      Effect.gen(function* () {
        let started = 0;
        const answer = Stream.unwrap(
          Effect.sync(() => {
            started++;
            return answerOf(bytesOf("a,b"));
          }),
        );
        expect(yield* Effect.flip(deliver(answer, { target: FILE }))).toEqual(
          new DeliveryFailure({
            code: "export-unavailable",
            message: "This device cannot write an export file.",
          }),
        );
        expect(started).toBe(0);
      }),
  );

  it.effect(
    "gives the document to the file port, and answers the receipt with the summary of the head",
    () =>
      Effect.gen(function* () {
        const { written, files } = collecting();
        const { measurements, observer } = observed();
        const receipt = yield* deliver(
          Stream.make(
            head,
            chunk(bytesOf("a,b")),
            chunk(bytesOf("\r\n")),
            trace,
          ),
          { target: FILE, files, observer },
        );
        expect(receipt).toBe(
          fileReceipt(QUERY_COMMAND, SUMMARY, {
            path: "/exports/items.csv",
            bytes: 5,
            format: "csv",
          }),
        );
        expect(written).toEqual([
          "/exports/items.csv",
          "a,b",
          "/exports/items.csv",
          "\r\n",
        ]);
        expect(measurements).toEqual([MEASUREMENT]);
      }),
  );

  it.effect(
    "answers output-error with the message of the port, and keeps the failure of the document as its own",
    () =>
      Effect.gen(function* () {
        const refusing: ExportFiles = {
          write: () =>
            Effect.fail(
              new ExportFileError({ message: "EEXIST: file already exists" }),
            ),
        };
        expect(
          yield* Effect.flip(
            deliver(answerOf(), { target: FILE, files: refusing }),
          ),
        ).toEqual(
          new DeliveryFailure({
            code: "output-error",
            message: "EEXIST: file already exists",
          }),
        );
        const { files } = collecting();
        expect(
          yield* Effect.flip(
            deliver(Stream.concat(answerOf(), Stream.fail("query failed")), {
              target: FILE,
              files,
            }),
          ),
        ).toBe("query failed");
      }),
  );

  it.effect(
    "stops the document at a cancel before the commit, so the port commits no file",
    () =>
      Effect.gen(function* () {
        const reading = yield* Deferred.make<void>();
        let committed = false;
        const files: ExportFiles = {
          write: (_path, document) =>
            Stream.runForEach(document, () =>
              Deferred.succeed(reading, undefined),
            ).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  committed = true;
                  return 0;
                }),
              ),
            ),
        };
        const delivery = yield* forkJob(
          deliver(Stream.concat(answerOf(bytesOf("a")), Stream.never), {
            target: FILE,
            files,
          }),
        );
        yield* Deferred.await(reading);

        yield* Fiber.interrupt(delivery);

        const exit = yield* Fiber.await(delivery);
        expect(
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        ).toBe(true);
        expect(committed).toBe(false);
      }),
  );

  it.effect(
    "reports the cancel request when it arrives, before the port has cleaned up",
    () =>
      Effect.gen(function* () {
        const reading = yield* Deferred.make<void>();
        const cleaning = yield* Deferred.make<void>();
        const cleaned = yield* Deferred.make<void>();
        const phases: string[] = [];
        const files: ExportFiles = {
          write: (_path, document) =>
            Stream.runForEach(document, () =>
              Deferred.succeed(reading, undefined),
            ).pipe(
              Effect.as(0),
              Effect.onInterrupt(() =>
                Deferred.succeed(cleaning, undefined).pipe(
                  Effect.andThen(Deferred.await(cleaned)),
                ),
              ),
            ),
        };
        const delivery = yield* forkJob(
          deliver(Stream.concat(answerOf(bytesOf("a")), Stream.never), {
            target: FILE,
            files,
            observer: {
              completed: () => {},
              cancelled: ({ phase }) => phases.push(phase),
            },
          }),
        );
        yield* Deferred.await(reading);
        yield* Effect.forkChild(Fiber.interrupt(delivery), {
          startImmediately: true,
        });
        yield* Deferred.await(cleaning);
        const beforeCleanup = [...phases];
        yield* Deferred.succeed(cleaned, undefined);

        expect(beforeCleanup).toContain("requested");
        const exit = yield* Fiber.await(delivery);
        expect(
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        ).toBe(true);
      }),
  );

  it.effect("answers the receipt to a cancel that arrives at the commit", () =>
    Effect.gen(function* () {
      const committing = yield* Deferred.make<void>();
      const linked = yield* Deferred.make<void>();
      const files: ExportFiles = {
        write: (_path, document) =>
          Stream.runDrain(document).pipe(
            Effect.andThen(Deferred.succeed(committing, undefined)),
            Effect.andThen(Deferred.await(linked)),
            Effect.as(1),
          ),
      };
      const delivery = yield* forkJob(
        deliver(answerOf(bytesOf("a")), { target: FILE, files }),
      );
      yield* Deferred.await(committing);
      const interrupting = yield* Effect.forkChild(Fiber.interrupt(delivery), {
        startImmediately: true,
      });

      yield* Deferred.succeed(linked, undefined);

      yield* Fiber.join(interrupting);
      expect(yield* Fiber.await(delivery)).toEqual(
        Exit.succeed(
          fileReceipt(QUERY_COMMAND, SUMMARY, {
            path: "/exports/items.csv",
            bytes: 1,
            format: "csv",
          }),
        ),
      );
    }),
  );

  it.effect(
    "settles a cancel at once while the job waits for its head, and gives the port no chunk",
    () =>
      Effect.gen(function* () {
        const waiting = yield* Deferred.make<void>();
        let closed = false;
        const { written, files } = collecting();
        const queued = Stream.fromEffect(
          Deferred.succeed(waiting, undefined).pipe(
            Effect.andThen(Effect.never),
          ),
        ).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              closed = true;
            }),
          ),
        );
        const delivery = yield* forkJob(
          deliver(queued, { target: FILE, files }),
        );
        yield* Deferred.await(waiting);

        yield* Fiber.interrupt(delivery);

        const exit = yield* Fiber.await(delivery);
        expect(
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        ).toBe(true);
        expect(closed).toBe(true);
        expect(written).toEqual([]);
      }),
  );
});
