import { Clock, Effect, Queue, Stream } from "effect";
import { Scheduler } from "effect";

import type { ZoteroDatabase } from "@zotlit/db";
import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { ItemQueryScheduler } from "@zotlit/item-query";
import type { ResolveAttachmentFile } from "@zotlit/item-query";
import { monotonicMillis } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import type { DbUnavailable } from "@zotlit/zotero-reads/contract/db-unavailable.ts";
import type { QueryAnswerPart } from "@zotlit/zotero-reads/contract/rpc.ts";
import { QueryFailed } from "@zotlit/zotero-reads/contract/rpc.ts";
import type { QueryJobRunner } from "@zotlit/zotero-reads/worker/handlers.ts";

import type { AnswerSink } from "./answer.ts";
import {
  encodeCommand,
  queryFailed,
  answerCustomFields,
  answerView,
} from "./answer.ts";
import { makeAttachmentFileResolver } from "./attachment-files.ts";
import type { QueryIdentity } from "./contract.ts";
import type { QueryMeter, WorkerMeasurement } from "./trace.ts";
import { createTrace, finishTrace } from "./trace.ts";
import type {
  QueryAnswer,
  QueryJob,
  QueryTypedJob,
} from "./worker-protocol.ts";

export interface QueryJobEnv {
  client: ZoteroDatabase;
  identity: Effect.Effect<QueryIdentity, DbUnavailable>;
  attachmentFiles: ResolveAttachmentFile;
  meter: QueryMeter;
}

export function runQueryJob(
  job: QueryTypedJob,
  env: Pick<QueryJobEnv, "client" | "attachmentFiles">,
): Effect.Effect<QueryAnswer> {
  return (
    "view" in job
      ? answerView(job, { attachmentFiles: env.attachmentFiles })
      : answerCustomFields(job.command)
  ).pipe(onItemQueryDatabase(env.client));
}

export function answerParts(
  job: QueryJob,
  env: QueryJobEnv,
): Stream.Stream<QueryAnswerPart, QueryFailed> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const now = monotonicMillis(yield* Clock.Clock);
      const startedAt = now();
      const trace = job.measure
        ? createTrace(env.meter, job.heap ?? false, now)
        : undefined;
      const answerSteps: number[] = [];
      const measured =
        trace &&
        ((): WorkerMeasurement =>
          JSON.parse(
            JSON.stringify(finishTrace(trace, { startedAt, answerSteps })),
          ) as WorkerMeasurement);
      return answerStream(
        (sink) =>
          encodeCommand(
            job,
            {
              identity: env.identity,
              attachmentFiles: env.attachmentFiles,
              instrument: trace?.instrument,
              onAnswerStep: trace && ((ms: number) => answerSteps.push(ms)),
            },
            sink,
          ).pipe(
            queryFailed(job),
            Effect.mapError((failed) =>
              measured
                ? new QueryFailed({
                    diagnostic: failed.diagnostic,
                    measurement: measured(),
                  })
                : failed,
            ),
            onItemQueryDatabase(env.client),
          ),
        measured,
      );
    }),
  );
}

const onItemQueryDatabase =
  (client: ZoteroDatabase) =>
  <A, E>(run: Effect.Effect<A, E, ItemQueryDatabase>): Effect.Effect<A, E> =>
    run.pipe(
      Effect.provideService(ItemQueryDatabase, { client }),
      Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
    );

const CHUNK_BYTES = 256 * 1024;

export function answerStream<E, R>(
  produce: (sink: AnswerSink) => Effect.Effect<void, E, R>,
  measured?: () => WorkerMeasurement,
): Stream.Stream<QueryAnswerPart, E, R> {
  return Stream.callback<QueryAnswerPart, E, R>(
    (queue) =>
      Effect.gen(function* () {
        const offer = (part: QueryAnswerPart) =>
          Effect.asVoid(Queue.offer(queue, part));
        let pending = "";
        const flush = Effect.suspend(() => {
          if (pending === "") return Effect.void;
          const bytes = encoder.encode(pending);
          pending = "";
          if (bytes.byteLength <= CHUNK_BYTES)
            return offer({ _tag: "Chunk", bytes });
          const starts: number[] = [];
          for (let at = 0; at < bytes.byteLength; at += CHUNK_BYTES)
            starts.push(at);
          return Effect.forEach(
            starts,
            (at) =>
              offer({
                _tag: "Chunk",
                bytes: bytes.slice(at, at + CHUNK_BYTES),
              }),
            { discard: true },
          );
        });
        yield* produce({
          head: (summary) => offer({ _tag: "Head", summary }),
          emit: (piece) =>
            Effect.suspend(() => {
              pending += piece;
              return pending.length >= CHUNK_BYTES ? flush : Effect.void;
            }),
        });
        yield* flush;
        if (measured) yield* offer({ _tag: "Trace", measurement: measured() });
        yield* Queue.end(queue);
      }),
    { bufferSize: 0 },
  );
}

export interface QueryJobRoot {
  readonly meter: QueryMeter;
}

export const makeQueryJobRunner = ({
  meter,
}: QueryJobRoot): QueryJobRunner => ({
  run: (job, { client }) =>
    Effect.gen(function* () {
      return yield* runQueryJob(job, {
        client,
        attachmentFiles: yield* makeAttachmentFileResolver(job.attachmentPaths),
      });
    }),
  answer: (job, { client, identity }) =>
    Stream.unwrap(
      Effect.map(
        makeAttachmentFileResolver(job.attachmentPaths),
        (attachmentFiles) =>
          answerParts(job, {
            client,
            attachmentFiles,
            meter,
            identity: Effect.map(identity, (source) => ({
              vault: job.vault,
              source,
            })),
          }),
      ),
    ),
  cancelled: (job) => ({
    command: job.command,
    cancelled: true,
  }),
});

const encoder = new TextEncoder();
