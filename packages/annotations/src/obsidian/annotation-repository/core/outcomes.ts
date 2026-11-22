import type {
  MutationState,
  TextField,
} from "#obsidian/annotation-repository/write.ts";
import { Effect } from "effect";

import { ANNOTATIONS } from "./model.ts";
import type { AnnotationMutation, OutcomeWrite } from "./model.ts";
import type { CoreState } from "./state.ts";

import { IDLE } from "#obsidian/annotation-repository/write.ts";

interface Outcome {
  write: OutcomeWrite;
  state: MutationState;
}

function mutationFor(core: CoreState, annotationKey: string): MutationState {
  const [running] = pendingWrites(core, annotationKey);
  return (
    (running && core.pendingStates.get(running)) ??
    standingOutcome(core, annotationKey) ??
    IDLE
  );
}

function settle(
  core: CoreState,
  annotationKey: string,
  outcome: Outcome,
): MutationState {
  leave(core, annotationKey, outcome);
  core.publish({ _tag: "annotation-changed", annotationKey });
  return outcome.state;
}

function leave(
  core: CoreState,
  annotationKey: string,
  { write, state }: Outcome,
): MutationState {
  const outcomes = core.outcomes.get(annotationKey) ?? new Map();
  outcomes.delete(write);
  if (state.kind === "failed" || state.kind === "conflict") {
    outcomes.set(write, state);
  }
  keepOutcomes(core, annotationKey, outcomes);
  return state;
}

function takeOver(
  core: CoreState,
  annotationKey: string,
  write: OutcomeWrite,
): void {
  const outcomes = core.outcomes.get(annotationKey);
  if (!outcomes) return;
  for (const [field, state] of outcomes) {
    if (field === write || state.kind === "failed") outcomes.delete(field);
  }
  keepOutcomes(core, annotationKey, outcomes);
}

function keepOutcomes(
  core: CoreState,
  annotationKey: string,
  outcomes: Map<OutcomeWrite, MutationState>,
): void {
  if (outcomes.size > 0) core.outcomes.set(annotationKey, outcomes);
  else core.outcomes.delete(annotationKey);
}

function standingOutcome(
  core: CoreState,
  annotationKey: string,
): MutationState | undefined {
  const outcomes = core.outcomes.get(annotationKey);
  return outcomes && [...outcomes.values()].at(-1);
}

function pendingWrites(
  core: CoreState,
  annotationKey: string,
): AnnotationMutation[] {
  return core.queries.client.getMutationCache().findAll({
    mutationKey: [ANNOTATIONS, annotationKey],
    status: "pending",
  }) as AnnotationMutation[];
}

function savingText(
  core: CoreState,
  field: TextField,
  annotationKey: string,
): AnnotationMutation | undefined {
  return pendingWrites(core, annotationKey).findLast(
    ({ options }) => options.mutationKey?.[2] === field,
  );
}

function answerOf(core: CoreState, mutation: AnnotationMutation) {
  return (
    core.operations.get(mutation) ??
    Effect.sync(() =>
      mutationFor(core, String(mutation.options.mutationKey?.[1])),
    )
  );
}

export {
  mutationFor,
  settle,
  leave,
  takeOver,
  standingOutcome,
  pendingWrites,
  savingText,
  answerOf,
};
