import type { ChangeEvent } from "#contract/rpc.ts";
import type {
  WebSyncProblem,
  WebSyncStatus,
} from "#contract/web-worker-rpc.ts";

import { DbUnavailable } from "#contract/rpc.ts";

export type Outcome =
  | { readonly kind: "ok" }
  | { readonly kind: "awaiting-consent"; readonly keyUserID: number }
  | { readonly kind: "problem"; readonly problem: WebSyncProblem };

export type Availability =
  | { readonly kind: "building"; readonly outcome: Outcome }
  | { readonly kind: "serving"; readonly outcome: Outcome }
  | { readonly kind: "unavailable"; readonly problem: WebSyncProblem };

export type Activity =
  | { readonly kind: "idle" }
  | { readonly kind: "syncing"; readonly progress: WebSyncStatus["progress"] };

export interface SourceState {
  readonly availability: Availability;
  readonly activity: Activity;
}

export type SourceEvent =
  | { readonly _tag: "opened"; readonly committed: boolean }
  | { readonly _tag: "open-failed"; readonly problem: WebSyncProblem }
  | { readonly _tag: "sync-started" }
  | { readonly _tag: "progress"; readonly progress: WebSyncStatus["progress"] }
  | { readonly _tag: "sync-ended" }
  | {
      readonly _tag: "awaiting-consent";
      readonly keyUserID: number;
      readonly committed: boolean;
    }
  | { readonly _tag: "emptied" }
  | { readonly _tag: "build-started" }
  | { readonly _tag: "committed" }
  | { readonly _tag: "refused"; readonly problem: WebSyncProblem }
  | {
      readonly _tag: "failed";
      readonly problem: WebSyncProblem;
      readonly served: boolean;
    }
  | { readonly _tag: "finished"; readonly changed: boolean };

export type SourceCommand =
  | { readonly _tag: "publish"; readonly event: ChangeEvent }
  | { readonly _tag: "admit"; readonly open: boolean }
  | { readonly _tag: "warn-sync-failed"; readonly problem: WebSyncProblem };

export const INITIAL: SourceState = {
  availability: { kind: "building", outcome: { kind: "ok" } },
  activity: { kind: "idle" },
};

const OK: Outcome = { kind: "ok" };

export function readState(state: SourceState) {
  const { availability } = state;
  if (availability.kind === "building")
    return { state: "loading", error: null } as const;
  if (availability.kind === "unavailable")
    return { state: "degraded", error: errorOf(state) } as const;
  return { state: "ready", error: null } as const;
}

export function errorOf(state: SourceState): DbUnavailable | null {
  const problem = problemOfState(state);
  return problem === null
    ? null
    : new DbUnavailable({ message: problem.message });
}

export function problemOfState(state: SourceState): WebSyncProblem | null {
  const { availability } = state;
  if (availability.kind === "unavailable") return availability.problem;
  return availability.outcome.kind === "problem"
    ? availability.outcome.problem
    : null;
}

export function unconsentedOf(state: SourceState): number | null {
  const { availability } = state;
  return availability.kind !== "unavailable" &&
    availability.outcome.kind === "awaiting-consent"
    ? availability.outcome.keyUserID
    : null;
}

const healthy = (state: SourceState) =>
  state.availability.kind === "serving" &&
  state.availability.outcome.kind === "ok";

const admitting = (availability: Availability) =>
  availability.kind !== "building";

function moveTo(
  state: SourceState,
  availability: Availability,
  publish: readonly ChangeEvent[] = [],
): { state: SourceState; commands: SourceCommand[] } {
  const commands: SourceCommand[] = [];
  if (admitting(availability) !== admitting(state.availability))
    commands.push({ _tag: "admit", open: admitting(availability) });
  for (const event of publish) commands.push({ _tag: "publish", event });
  return { state: { ...state, availability }, commands };
}

const stateEvent = (availability: Availability): ChangeEvent => ({
  _tag: "state",
  ...readState({ availability, activity: { kind: "idle" } }),
});

const degraded = (problem: WebSyncProblem): ChangeEvent => ({
  _tag: "degraded",
  error: new DbUnavailable({ message: problem.message }),
});

export function describe(state: SourceState): string {
  const { availability, activity } = state;
  const outcome =
    availability.kind === "unavailable" ? "problem" : availability.outcome.kind;
  return `${availability.kind}/${outcome}/${activity.kind}`;
}

export function transition(
  state: SourceState,
  event: SourceEvent,
): { readonly state: SourceState; readonly commands: SourceCommand[] } {
  switch (event._tag) {
    case "opened":
      return moveTo(
        state,
        event.committed
          ? { kind: "serving", outcome: OK }
          : { kind: "building", outcome: OK },
      );
    case "open-failed":
      return moveTo(state, { kind: "unavailable", problem: event.problem }, [
        degraded(event.problem),
      ]);
    case "sync-started":
      return {
        state: { ...state, activity: { kind: "syncing", progress: null } },
        commands: [
          { _tag: "publish", event: { _tag: "refreshing", active: true } },
        ],
      };
    case "progress":
      return state.activity.kind === "syncing"
        ? {
            state: {
              ...state,
              activity: { kind: "syncing", progress: event.progress },
            },
            commands: [],
          }
        : { state, commands: [] };
    case "sync-ended":
      return {
        state: { ...state, activity: { kind: "idle" } },
        commands: [
          { _tag: "publish", event: { _tag: "refreshing", active: false } },
        ],
      };
    case "awaiting-consent": {
      const outcome: Outcome = {
        kind: "awaiting-consent",
        keyUserID: event.keyUserID,
      };
      if (state.availability.kind === "unavailable") {
        const next: Availability = event.committed
          ? { kind: "serving", outcome }
          : { kind: "building", outcome };
        return moveTo(state, next, [stateEvent(next)]);
      }
      return moveTo(state, { kind: state.availability.kind, outcome });
    }
    case "emptied": {
      const next: Availability = { kind: "building", outcome: OK };
      return moveTo(state, next, [stateEvent(next)]);
    }
    case "build-started": {
      if (state.availability.kind === "building")
        return {
          state: { ...state, availability: { kind: "building", outcome: OK } },
          commands: [],
        };
      const next: Availability = { kind: "building", outcome: OK };
      return moveTo(state, next, [stateEvent(next)]);
    }
    case "committed":
      return moveTo(state, { kind: "serving", outcome: OK }, [
        { _tag: "changed" },
      ]);
    case "refused":
      return transition(state, {
        _tag: "failed",
        problem: event.problem,
        served: state.availability.kind === "serving",
      });
    case "failed": {
      if (!event.served)
        return moveTo(state, { kind: "unavailable", problem: event.problem }, [
          degraded(event.problem),
        ]);
      const moved = moveTo(state, {
        kind: "serving",
        outcome: { kind: "problem", problem: event.problem },
      });
      return {
        state: moved.state,
        commands: [
          { _tag: "warn-sync-failed", problem: event.problem },
          ...moved.commands,
        ],
      };
    }
    case "finished": {
      const next: Availability = { kind: "serving", outcome: OK };
      return moveTo(
        state,
        next,
        !healthy(state) && !event.changed ? [stateEvent(next)] : [],
      );
    }
  }
}
