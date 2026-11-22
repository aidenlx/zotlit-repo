import {
  Cause,
  Clock,
  Effect,
  Exit,
  FileSystem,
  PlatformError,
  Scope,
} from "effect";
// oxlint-disable-next-line no-restricted-imports -- ItemQueryScheduler uses MessageChannel and adds a per-query time budget.
import { Scheduler } from "effect";

import type { ZoteroDatabase } from "@zotlit/db";
import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { ItemQueryScheduler } from "@zotlit/item-query";
import type { ResolveAttachmentFile } from "@zotlit/item-query";
import { monotonicMillis } from "@zotlit/plugin-kernel/effect-clock.ts";
import type { WorkbenchIdentity } from "@zotlit/template-workbench/desktop/cli/envelope.ts";
import type { QueryJobRunner } from "@zotlit/zotero-reads/worker/handlers.ts";

import {
  answer,
  answerCustomFields,
  answerView,
  QueryOutputError,
} from "./answer.ts";
import type { QueryWriter } from "./answer.ts";
import { diagnostic, failure } from "./contract.ts";
import { createTrace, finishTrace } from "./trace.ts";
import type { WorkerMeasurement } from "./trace.ts";
import type { QueryAnswer, QueryJob } from "./worker-protocol.ts";

import { makeAttachmentFileResolver } from "#core/item-query/attachment-files.ts";

export interface QueryJobEnv {
  client: ZoteroDatabase;
  identity: WorkbenchIdentity;
  attachmentFiles: ResolveAttachmentFile;
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
    const trace = job.measure ? createTrace(job.heap ?? false, now) : undefined;
    const answerSteps: number[] = [];
    const heapBefore = job.heap ? process.memoryUsage().heapUsed : undefined;
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
              openOutput: () => openStage(fs, job.stagePath, stage),
            });
    if (!trace) return reply;
    return {
      ...reply,
      measurement: JSON.parse(
        JSON.stringify(
          finishTrace(trace, { startedAt, answerSteps, heapBefore }),
        ),
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

export const queryJobRunner: QueryJobRunner = {
  run: (job, { client, databaseFile }) =>
    Effect.gen(function* () {
      const databasePath = databaseFile ?? job.source.databasePath;
      return yield* runQueryJob(job, {
        client,
        attachmentFiles: yield* makeAttachmentFileResolver(job.attachmentPaths),
        identity: {
          vault: job.vault,
          source: {
            databasePath,
            id: databasePath === job.source.databasePath ? job.source.id : null,
          },
        },
      });
    }),
  cancelled: (job) => ({
    command: job.command,
    answer: "",
    receipt: { kind: "inline" },
    cancelled: true,
  }),
};

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
      write: (text: string) =>
        fileStep(file.writeAll(encoder.encode(text))).pipe(
          Effect.uninterruptible,
        ),
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
