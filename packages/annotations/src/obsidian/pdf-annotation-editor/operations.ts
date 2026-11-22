import type { CopyInstant } from "#obsidian/annotation-repository/capability-copy.ts";
import type {
  AnnotationRepository,
  CreateOutcome,
  HistoryDirection,
  HistoryOutcome,
  WriteRunFailed,
} from "#obsidian/annotation-repository/service.ts";
import type {
  AnnotationDraft,
  GeometryInput,
  MutationState,
  WriteFailure,
} from "#obsidian/annotation-repository/write.ts";
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Schema,
  Semaphore,
} from "effect";
import type { Scope } from "effect";

import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type {
  PdfPosition,
  PdfTextStructure,
  SelectedText,
  TextSelection,
} from "@zotlit/pdf-structure";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

import type { EditablePosition } from "./geometry-edit.ts";
import { readerSurfaceRegistry } from "./reader-surface-model.ts";
import type { ReaderSurfaceRegistry } from "./reader-surface-model.ts";

import { historyOutcomeNotice } from "#obsidian/annotation-repository/actions.ts";
import {
  groupFailureMessages,
  writeFailureReason,
} from "#obsidian/annotation-repository/write.ts";

export type WriteRun = Fiber.Fiber<unknown, never>;

export type BindingWrites = <A>(
  effect: Effect.Effect<A>,
) => Fiber.Fiber<A, never>;

export const bindingWrites: Effect.Effect<BindingWrites, never, Scope.Scope> =
  Effect.map(
    Effect.flatMap(FiberSet.make(), (fibers) =>
      FiberSet.runtime(fibers)<never>(),
    ),
    (fork) => (effect) =>
      fork(
        effect.pipe(
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("A PDF view's write died").pipe(
                  Effect.annotateLogs({ error: Cause.squash(cause) }),
                  withLogCategory("pdf-annotation-editor"),
                ),
          ),
        ),
      ),
  );

export const bindingResources: Effect.Effect<
  { readonly registry: ReaderSurfaceRegistry; readonly writes: BindingWrites },
  never,
  Scope.Scope
> = Effect.gen(function* () {
  const registry = yield* readerSurfaceRegistry;
  const writes = yield* bindingWrites;
  return { registry, writes };
});

export function settledOf(
  bridge: Pick<EffectBridge, "runPromiseExit">,
  run: WriteRun | null,
): Promise<void> {
  return run
    ? bridge.runPromiseExit(Fiber.await(run)).then(() => undefined)
    : Promise.resolve();
}

export const reportBlockedEdit = Effect.fn(
  "PdfAnnotationEditor.reportBlockedEdit",
)(function* (
  annotations: Pick<AnnotationRepository["Service"], "probe">,
  report: () => void,
) {
  yield* annotations.probe;
  report();
});

class PdfStructureReadError extends Schema.TaggedError<
  PdfStructureReadError,
  { readonly brand: unique symbol }
>()("PdfStructureReadError", { cause: Schema.Defect() }) {}

const UNKNOWN_OUTCOME = {
  kind: "failed",
  failure: { kind: "unknown-outcome" },
} as const satisfies MutationState;

export type CreateWrite = Effect.Effect<string | null>;

export interface CreateSeam {
  begin: () => void;
  created: (annotationKey: string) => void;
  failed: (reason: string) => void;
  end: (annotationKey: string | null) => void;
  now: () => CopyInstant;
}

export const createMark = Effect.fn("PdfAnnotationEditor.createMark")(
  function* (
    annotations: Pick<
      AnnotationRepository["Service"],
      "createAnnotation" | "hold"
    >,
    {
      attachmentKey,
      structure,
      draft,
      previous,
      group,
      uninterruptible = false,
    }: {
      attachmentKey: string;
      structure: PdfTextStructure;
      draft: Omit<AnnotationDraft, "parentKey" | "sortIndex" | "pageLabel"> & {
        position: PdfPosition;
      };
      previous: { pageLabel: string; pageIndex: number }[];
      group?: string;
      uninterruptible?: boolean;
    },
    seam: CreateSeam,
  ) {
    const unknown = () =>
      seam.failed(writeFailureReason(UNKNOWN_OUTCOME.failure, seam.now()));
    let key: string | null = null;
    return yield* Effect.uninterruptibleMask((restore) => {
      const read = Effect.tryPromise({
        try: () =>
          Promise.all([
            structure.sortIndex(draft.position),
            structure.pageLabel(draft.position.pageIndex, previous),
          ]),
        catch: (cause) => new PdfStructureReadError({ cause }),
      });
      const send = Effect.gen(function* () {
        const [sortIndex, pageLabel] = yield* uninterruptible
          ? read
          : restore(read);
        return yield* annotations.createAnnotation(
          attachmentKey,
          { ...draft, sortIndex, pageLabel },
          { group },
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("An Annotation was not created").pipe(
            Effect.annotateLogs({ type: draft.type, error }),
            withLogCategory("pdf-annotation-editor"),
            Effect.as<CreateOutcome>(UNKNOWN_OUTCOME),
          ),
        ),
      );
      return Effect.acquireUseRelease(
        annotations
          .hold([attachmentKey])
          .pipe(Effect.tap(() => Effect.sync(() => seam.begin()))),
        () =>
          Effect.flatMap(send, (outcome) => {
            if (outcome.kind === "failed") {
              seam.failed(writeFailureReason(outcome.failure, seam.now()));
              return Effect.succeed(null);
            }
            const created = outcome.annotationKey;
            key = created;
            return Effect.try(() => seam.created(created)).pipe(
              Effect.catch((error) =>
                Effect.logWarning("An Annotation create did not finish").pipe(
                  Effect.annotateLogs({ type: draft.type, error: error.cause }),
                  withLogCategory("pdf-annotation-editor"),
                ),
              ),
              Effect.as(created),
            );
          }),
        (held, exit) =>
          Effect.sync(() => {
            if (
              key === null &&
              Exit.isFailure(exit) &&
              !Cause.hasInterruptsOnly(exit.cause)
            )
              unknown();
            seam.end(key);
            held[Symbol.dispose]();
          }),
      );
    });
  },
);

export const oneAtATime = (): Semaphore.Semaphore => Semaphore.makeUnsafe(1);

export const queued = <A>(
  queue: Semaphore.Semaphore,
  make: () => Effect.Effect<A> | null,
): Effect.Effect<A | void> =>
  queue.withPermits(1)(Effect.suspend(() => make() ?? Effect.void));

export const placeSelection = Effect.fn("PdfAnnotationEditor.placeSelection")(
  function* (
    structure: PdfTextStructure,
    selection: TextSelection,
    place: (captured: SelectedText) => void,
  ) {
    const captured = yield* captureText(structure, selection).pipe(
      Effect.catchTag("PdfStructureReadError", (error) =>
        Effect.logWarning(
          "Could not place the text selection on the page",
        ).pipe(
          Effect.annotateLogs({ error }),
          withLogCategory("pdf-annotation-editor"),
          Effect.as(null),
        ),
      ),
    );
    if (captured) place(captured);
    else
      yield* Effect.logDebug(
        "Text selection maps onto no character of its pages",
      ).pipe(
        Effect.annotateLogs({
          pageIndexes: selection.pages.map(({ pageIndex }) => pageIndex),
        }),
        withLogCategory("pdf-annotation-editor"),
      );
  },
);

export const captureText = Effect.fn("PdfAnnotationEditor.captureText")(
  (structure: PdfTextStructure, selection: TextSelection) =>
    Effect.tryPromise({
      try: () => structure.selectText(selection),
      catch: (cause) => new PdfStructureReadError({ cause }),
    }),
);

export const saveGeometry = Effect.fn("PdfAnnotationEditor.saveGeometry")(
  function* (
    annotations: Pick<AnnotationRepository["Service"], "patchGeometry">,
    notifier: Pick<Notifier["Service"], "show">,
    {
      readSortIndex,
      key,
      proposal,
      text,
      input,
      end,
      now,
      message,
    }: {
      readSortIndex: (position: PdfPosition) => Promise<string | null>;
      key: string;
      proposal: EditablePosition;
      text?: string;
      input: GeometryInput;
      end: () => void;
      now: () => CopyInstant;
      message: FailureMessage;
    },
  ) {
    const save = Effect.fnUntraced(function* (
      restore: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>,
    ) {
      const sortIndex = yield* restore(
        Effect.tryPromise({
          try: () => readSortIndex(proposal),
          catch: (cause) => new PdfStructureReadError({ cause }),
        }),
      );
      if (sortIndex === null) return { kind: "idle" } as const;
      end();
      return yield* annotations.patchGeometry(
        key,
        { position: proposal, sortIndex, ...(text !== undefined && { text }) },
        input,
      );
    });
    return yield* Effect.uninterruptibleMask((restore) =>
      reportWrite(
        notifier,
        save(restore).pipe(
          Effect.catchTag(
            ["PdfStructureReadError", "WriteRunFailed"],
            (error) =>
              Effect.logWarning(
                "An Annotation geometry edit did not finish",
              ).pipe(
                Effect.annotateLogs({ error }),
                withLogCategory("pdf-annotation-editor"),
                Effect.as<MutationState>(UNKNOWN_OUTCOME),
              ),
          ),
        ),
        { verb: "edit", now, message },
      ),
    ).pipe(Effect.ensuring(Effect.sync(end)));
  },
);

type FailureMessage = (failure: WriteFailure, now: CopyInstant) => string;

export const reportWrites = Effect.fn("PdfAnnotationEditor.reportWrites")(
  function* <E>(
    notifier: Pick<Notifier["Service"], "show">,
    send: Effect.Effect<readonly MutationState[], E>,
    {
      verb,
      now,
      message,
    }: { verb: string; now: () => CopyInstant; message?: FailureMessage },
  ) {
    const exit = yield* Effect.exit(send);
    if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause))
      return yield* Effect.failCause(exit.cause);
    if (Exit.isFailure(exit))
      yield* Effect.logWarning("A write failed before Zotero answered").pipe(
        Effect.annotateLogs({ verb, error: Cause.squash(exit.cause) }),
        withLogCategory("pdf-annotation-editor"),
      );
    const outcomes = Exit.isSuccess(exit) ? exit.value : [UNKNOWN_OUTCOME];
    for (const text of groupFailureMessages(outcomes, now(), message))
      yield* notifier.show(text);
    return outcomes;
  },
);

export const reportWrite = <E>(
  notifier: Pick<Notifier["Service"], "show">,
  write: Effect.Effect<MutationState, E>,
  options: { verb: string; now: () => CopyInstant; message?: FailureMessage },
) =>
  reportWrites(
    notifier,
    Effect.map(write, (state) => [state]),
    options,
  );

export const recolorMarks = (
  annotations: Pick<
    AnnotationRepository["Service"],
    "patchColor" | "patchColors"
  >,
  annotationKeys: readonly string[],
  color: string,
): Effect.Effect<readonly MutationState[], WriteRunFailed> => {
  const [first] = annotationKeys;
  if (first === undefined) return Effect.succeed([]);
  return annotationKeys.length === 1
    ? Effect.map(annotations.patchColor(first, color), (state) => [state])
    : annotations.patchColors(annotationKeys, color);
};

export const eraseMarks = (
  annotations: Pick<
    AnnotationRepository["Service"],
    "deleteAnnotation" | "deleteAnnotations"
  >,
  annotationKeys: readonly string[],
): Effect.Effect<readonly MutationState[], WriteRunFailed> => {
  const [first] = annotationKeys;
  if (first === undefined) return Effect.succeed([]);
  return annotationKeys.length === 1
    ? Effect.map(annotations.deleteAnnotation(first), (state) => [state])
    : annotations.deleteAnnotations(annotationKeys);
};

export const stepMarkHistory = Effect.fn("PdfAnnotationEditor.stepHistory")(
  function* (
    annotations: Pick<AnnotationRepository["Service"], "undo" | "redo">,
    notifier: Pick<Notifier["Service"], "show">,
    {
      attachmentKey,
      direction,
      now,
    }: {
      attachmentKey: string;
      direction: HistoryDirection;
      now: () => CopyInstant;
    },
  ) {
    const outcome = yield* Effect.uninterruptible(
      (direction === "undo"
        ? annotations.undo(attachmentKey)
        : annotations.redo(attachmentKey)
      ).pipe(
        recover(
          (cause) =>
            Effect.logWarning(
              "A History Step failed before Zotero answered",
            ).pipe(
              Effect.annotateLogs({ direction, error: Cause.squash(cause) }),
              withLogCategory("pdf-annotation-editor"),
            ),
          Effect.succeed<HistoryOutcome>(UNKNOWN_OUTCOME),
        ),
      ),
    );
    const notice = historyOutcomeNotice(outcome, now());
    if (notice !== null) yield* notifier.show(notice);
    return outcome;
  },
);

export const pressHistory = Effect.fn("PdfAnnotationEditor.pressHistory")(
  function* (
    presses: Semaphore.Semaphore,
    step: Effect.Effect<HistoryOutcome>,
    land: (outcome: HistoryOutcome) => Promise<void> | void,
  ) {
    yield* presses.withPermits(1)(
      Effect.flatMap(step, (outcome) =>
        Effect.promise(async () => land(outcome)),
      ),
    );
  },
);

export const readMarks = (
  annotations: Pick<AnnotationRepository["Service"], "read">,
  attachmentKey: string,
  path: string | null,
) =>
  annotations.read(attachmentKey).pipe(
    Effect.tapCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Effect.logWarning(
            "Failed to read the annotations of an open PDF",
          ).pipe(
            Effect.annotateLogs({
              error: Cause.squash(cause),
              path,
              attachmentKey,
            }),
            withLogCategory("pdf-annotation-editor"),
          ),
    ),
  );
