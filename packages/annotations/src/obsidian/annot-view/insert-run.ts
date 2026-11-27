import type { Fiber } from "effect";
import { Cause, Effect } from "effect";

import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

import type { Placement, captureInsertion } from "./async-insert.ts";
import type {
  AnnotationInsertOutcome,
  AnnotationInsertRequest,
  AnnotationInsertSubject,
} from "./note-actions.ts";

export type InsertFiber = Fiber.Fiber<AnnotationInsertOutcome>;

export interface InsertRunner<R> {
  execute: (
    request: AnnotationInsertRequest,
  ) => Effect.Effect<AnnotationInsertOutcome, unknown, R>;
  run: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>;
}

export function startInsert<R>(
  runner: InsertRunner<R>,
  options: AnnotationInsertSubject & {
    notePath: string;
    placement?: Placement;
    capture: () => ReturnType<typeof captureInsertion>;
  },
): InsertFiber {
  const { capture, ...request } = options;
  const annotationKey =
    "hit" in request ? request.hit.key : request.annotation.key;
  return runner.run(
    Effect.gen(function* () {
      const target = yield* Effect.acquireDisposable(Effect.sync(capture));
      const cancelled = Effect.callback<never>((resume) => {
        const release = target.onCancel(() => resume(Effect.interrupt));
        return Effect.sync(release);
      });
      return yield* Effect.raceFirst(
        runner.execute({ ...request, target }),
        cancelled,
      );
    }).pipe(
      Effect.scoped,
      recover(
        (cause) =>
          Effect.logWarning("Annotation insert failed").pipe(
            Effect.annotateLogs({
              annotationKey,
              error: Cause.squash(cause),
            }),
          ),
        Effect.succeed<AnnotationInsertOutcome>({ kind: "failed" }),
      ),
      withLogCategory("views", "annot-view"),
    ),
  );
}
