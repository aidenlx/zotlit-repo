import {
  Cause,
  Clock,
  Effect,
  Exit,
  FileSystem,
  PlatformError,
  Scope,
} from "effect";
import { Scheduler } from "effect";

import type { ZoteroDatabase } from "@zotlit/db";
import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { ItemQueryScheduler } from "@zotlit/item-query";
import type { ResolveAttachmentFile } from "@zotlit/item-query";
import { monotonicMillis } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import type { DbUnavailable } from "@zotlit/zotero-reads/contract/db-unavailable.ts";
import type { QueryJobRunner } from "@zotlit/zotero-reads/worker/handlers.ts";

import {
  answer,
  answerCustomFields,
  answerView,
  exportUnavailable,
  QueryOutputError,
} from "./answer.ts";
import type { QueryWriter } from "./answer.ts";
import { makeAttachmentFileResolver } from "./attachment-files.ts";
import { diagnostic, failure } from "./contract.ts";
import type { QueryIdentity } from "./contract.ts";
import { createTrace, finishTrace } from "./trace.ts";
import type { QueryMeter, WorkerMeasurement } from "./trace.ts";
import type { QueryAnswer, QueryJob } from "./worker-protocol.ts";

export interface QueryJobEnv {
  client: ZoteroDatabase;
  identity: Effect.Effect<QueryIdentity, DbUnavailable>;
  attachmentFiles: ResolveAttachmentFile;
  meter: QueryMeter;
  writesFiles: boolean;
}

export function runQueryJob(
  job: QueryJob,
  env: QueryJobEnv,
): Effect.Effect<QueryAnswer, never, FileSystem.FileSystem> {
  const stage: StageState = {};
  return Effect.gen(function* () {
    const now = monotonicMillis(yield* Clock.Clock);
    const fs = yield* FileSystem.FileSystem;
    const startedAt = now();
    const trace = job.measure
      ? createTrace(env.meter, job.heap ?? false, now)
      : undefined;
    const answerSteps: number[] = [];
    const reply =
      "view" in job
        ? yield* answerView(job, { attachmentFiles: env.attachmentFiles })
        : "customFields" in job
          ? yield* answerCustomFields(job.command)
          : yield* answer(job, {
              identity: env.identity,
              attachmentFiles: env.attachmentFiles,
              instrument: trace?.instrument,
              onAnswerStep: job.measure
                ? (ms: number) => answerSteps.push(ms)
                : undefined,
              openOutput: env.writesFiles
                ? () => openStage(fs, job.stagePath, stage)
                : undefined,
            });
    if (!trace) return reply;
    return {
      ...reply,
      measurement: JSON.parse(
        JSON.stringify(finishTrace(trace, { startedAt, answerSteps })),
      ) as WorkerMeasurement,
    };
  }).pipe(
    Effect.scoped,
    Effect.flatMap((answer) => {
      const { closeError } = stage;
      if (closeError === undefined) return Effect.succeed(answer);
      if (!PlatformError.isPlatformError(closeError))
        return Effect.die(closeError);
      return Effect.succeed<QueryAnswer>({
        command: job.command,
        answer: failure(job.command, outputError(closeError).diagnostic),
        receipt: { kind: "inline" },
      });
    }),
    Effect.provideService(ItemQueryDatabase, { client: env.client }),
    Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
  );
}

export interface QueryJobRoot {
  readonly meter: QueryMeter;
  readonly writesFiles: boolean;
}

export const makeQueryJobRunner = ({
  meter,
  writesFiles,
}: QueryJobRoot): QueryJobRunner => ({
  run: (job, { client, identity }) =>
    Effect.gen(function* () {
      return yield* runQueryJob(job, {
        client,
        attachmentFiles: yield* makeAttachmentFileResolver(job.attachmentPaths),
        meter,
        writesFiles,
        identity: Effect.map(identity, (source) => ({
          vault: job.vault,
          source,
        })),
      });
    }),
  refused: (job) =>
    !writesFiles && "query" in job && job.query?.output !== undefined
      ? exportUnavailable(job.command)
      : undefined,
  cancelled: (job) => ({
    command: job.command,
    answer: "",
    receipt: { kind: "inline" },
    cancelled: true,
  }),
});

interface StageState {
  closeError?: unknown;
}

const encoder = new TextEncoder();

function openStage(
  fs: FileSystem.FileSystem,
  stagePath: string | undefined,
  stage: StageState,
): Effect.Effect<QueryWriter, QueryOutputError, Scope.Scope> {
  if (stagePath === undefined)
    return Effect.die(new Error("Item Query export has no staging path"));
  return Effect.gen(function* () {
    const fileScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Effect.exit(Scope.close(scope, Exit.void)).pipe(
        Effect.flatMap((exit) =>
          Effect.sync(() => {
            if (Exit.isFailure(exit))
              stage.closeError = Cause.squash(exit.cause);
          }),
        ),
      ),
    );
    const file = yield* fileStep(
      fs
        .open(stagePath, { flag: "wx", mode: 0o600 })
        .pipe(Scope.provide(fileScope)),
    );
    return {
      write: (text: string) => {
        const bytes = encoder.encode(text);
        return fileStep(file.writeAll(bytes)).pipe(
          Effect.as(bytes.byteLength),
          Effect.uninterruptible,
        );
      },
    };
  });
}

function fileStep<A>(
  step: Effect.Effect<A, PlatformError.PlatformError>,
): Effect.Effect<A, QueryOutputError> {
  return step.pipe(Effect.mapError((error) => outputError(error)));
}

function outputError(error: PlatformError.PlatformError): QueryOutputError {
  return new QueryOutputError({
    diagnostic: diagnostic(
      "output-error",
      Error.isError(error.cause) ? error.cause.message : error.message,
    ),
  });
}
