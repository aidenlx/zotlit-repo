import type { ExportFiles } from "#core/item-query/export-files.ts";
import type { AnswerSummary } from "#worker/item-query/answer.ts";
import type {
  QueryCliCommand,
  QueryOutputFormat,
} from "#worker/item-query/contract.ts";
import type {
  CancellationEvent,
  QueryObserver,
  WorkerMeasurement,
} from "#worker/item-query/trace.ts";
import type { Scope } from "effect";
import { Cause, Clock, Data, Effect, Exit, Fiber, Pull, Stream } from "effect";

import type { QueryAnswerPart } from "@zotlit/zotero-reads/contract/rpc.ts";
import { QueryFailed } from "@zotlit/zotero-reads/contract/rpc.ts";

import { ExportFileError } from "#core/item-query/export-files.ts";
import { fileReceipt } from "#worker/item-query/contract.ts";

export const INLINE_MAX_BYTES = 1024 * 1024;

export type AnswerTarget =
  | { readonly kind: "inline" }
  | {
      readonly kind: "file";
      readonly path: string;
      readonly format: QueryOutputFormat;
    };

export class DeliveryFailure extends Data.TaggedError("DeliveryFailure")<{
  readonly code: "result-too-large" | "output-error" | "export-unavailable";
  readonly message: string;
}> {}

export interface AnswerDelivery<E> {
  readonly command: QueryCliCommand;
  readonly target: AnswerTarget;
  readonly answer: Stream.Stream<QueryAnswerPart, E>;
  readonly files: ExportFiles | undefined;
  readonly observer?: QueryObserver | undefined;
}

export const deliverAnswer = <E>({
  command,
  target,
  answer,
  files,
  observer,
}: AnswerDelivery<E>): Effect.Effect<string, E | DeliveryFailure> => {
  if (target.kind === "file" && files === undefined)
    return Effect.fail(
      new DeliveryFailure({
        code: "export-unavailable",
        message: "This device cannot write an export file.",
      }),
    );
  const delivery =
    target.kind === "file"
      ? toFile({ command, target, answer, files: files!, observer })
      : Effect.interruptible(toInline(answer, observer));
  return Effect.gen(function* () {
    const running = yield* Effect.forkChild(delivery, {
      startImmediately: true,
      uninterruptible: true,
    });
    const waited = yield* Effect.exit(
      Effect.interruptible(Fiber.await(running)),
    );
    if (Exit.isSuccess(waited)) return yield* waited.value;
    yield* reportCancel(observer, "requested");
    yield* reportCancel(observer, "sent");
    yield* Fiber.interrupt(running);
    return yield* Fiber.join(running);
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        if (error instanceof QueryFailed && error.measurement)
          observer?.completed(error.measurement);
      }),
    ),
  );
};

const toInline = <E>(
  answer: Stream.Stream<QueryAnswerPart, E>,
  observer: QueryObserver | undefined,
) =>
  Effect.gen(function* () {
    const { document, trace } = yield* readAnswer(answer);
    const completed = Effect.map(trace, (measurement) => {
      if (measurement) observer?.completed(measurement);
    });
    const text = yield* inline(document).pipe(
      Effect.tapErrorTag("DeliveryFailure", () =>
        observer === undefined
          ? Effect.void
          : Effect.andThen(Stream.runDrain(document), completed),
      ),
    );
    yield* completed;
    return text;
  }).pipe(Effect.scoped);

const toFile = <E>({
  command,
  target,
  answer,
  files,
  observer,
}: AnswerDelivery<E> & {
  readonly target: Extract<AnswerTarget, { kind: "file" }>;
  readonly files: ExportFiles;
}) =>
  Effect.gen(function* () {
    const read = yield* Effect.cached(readAnswer(answer));
    const document = Stream.unwrap(
      Effect.map(Effect.interruptible(read), ({ document }) =>
        Stream.transformPull(document, (pull) =>
          Effect.succeed(Effect.interruptible(pull)),
        ),
      ),
    );
    const bytes = yield* files.write(target.path, document).pipe(
      Effect.catchIf(
        (error) => error instanceof ExportFileError,
        ({ message }) =>
          Effect.fail(new DeliveryFailure({ code: "output-error", message })),
      ),
    );
    const { summary, trace } = yield* read;
    const measurement = yield* trace;
    if (measurement) observer?.completed(measurement);
    return fileReceipt(command, summary, {
      path: target.path,
      bytes,
      format: target.format,
    });
  }).pipe(Effect.scoped);

const inline = <E>(
  document: Stream.Stream<Uint8Array, E>,
): Effect.Effect<string, E | DeliveryFailure> =>
  Effect.suspend(() => {
    const parts: Uint8Array[] = [];
    let bytes = 0;
    return document.pipe(
      Stream.runForEach((part) => {
        bytes += part.byteLength;
        if (bytes > INLINE_MAX_BYTES)
          return Effect.fail(
            new DeliveryFailure({
              code: "result-too-large",
              message: `The JSON response exceeds the inline limit of ${INLINE_MAX_BYTES} bytes.`,
            }),
          );
        parts.push(part);
        return Effect.void;
      }),
      Effect.map(() => {
        const all = new Uint8Array(bytes);
        let at = 0;
        for (const part of parts) {
          all.set(part, at);
          at += part.byteLength;
        }
        return new TextDecoder("utf-8", { ignoreBOM: true }).decode(all);
      }),
    );
  });

interface Answer<E> {
  readonly summary: AnswerSummary;
  readonly document: Stream.Stream<Uint8Array, E>;
  readonly trace: Effect.Effect<WorkerMeasurement | undefined>;
}

const readAnswer = <E>(
  parts: Stream.Stream<QueryAnswerPart, E>,
): Effect.Effect<Answer<E>, E, Scope.Scope> =>
  Effect.gen(function* () {
    const pull = yield* Stream.toPull(parts);
    let buffered: QueryAnswerPart[] = [];
    let ended = false;
    let measurement: WorkerMeasurement | undefined;
    const next: Effect.Effect<QueryAnswerPart | undefined, E> = Effect.suspend(
      () => {
        const part = buffered.shift();
        if (part !== undefined || ended) return Effect.succeed(part);
        return pull.pipe(
          Effect.map((received): QueryAnswerPart | undefined => {
            buffered = received.slice(1);
            return received[0];
          }),
          Pull.catchDone(() =>
            Effect.sync(() => {
              ended = true;
              return undefined;
            }),
          ),
        );
      },
    );
    const head = yield* next;
    if (head?._tag !== "Head") return yield* outOfOrder(head);
    const chunk: Pull.Pull<readonly [Uint8Array], E> = Effect.flatMap(
      next,
      (part) => {
        if (part === undefined) return Cause.done();
        if (measurement !== undefined) return outOfOrder(part);
        if (part._tag === "Chunk") return Effect.succeed([part.bytes] as const);
        if (part._tag === "Head") return outOfOrder(part);
        measurement = part.measurement;
        return Effect.flatMap(next, (after) =>
          after === undefined ? Cause.done() : outOfOrder(after),
        );
      },
    );
    return {
      summary: head.summary,
      document: Stream.fromPull(Effect.succeed(chunk)),
      trace: Effect.sync(() => measurement),
    };
  });

const outOfOrder = (part: QueryAnswerPart | undefined): Effect.Effect<never> =>
  Effect.die(
    new Error(
      `A ZotLit Query answer stream has ${part?._tag ?? "its end"} out of order`,
    ),
  );

export function reportCancel(
  observer: QueryObserver | undefined,
  phase: CancellationEvent["phase"],
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (observer?.cancelled === undefined) return;
    const atEpochMs = yield* Clock.currentTimeMillis;
    observer.cancelled({ phase, atEpochMs });
  });
}
