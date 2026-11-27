import type { WebSyncProblem } from "#contract/web-worker-rpc.ts";

import { describe, transition } from "./web-api-machine.ts";
import type { SourceEvent, SourceState } from "./web-api-machine.ts";

const PROBLEM: WebSyncProblem = { _tag: "network", message: "offline" };

const AVAILABILITIES: readonly SourceState["availability"][] = [
  { kind: "building", outcome: { kind: "ok" } },
  { kind: "building", outcome: { kind: "awaiting-consent", keyUserID: 42 } },
  { kind: "serving", outcome: { kind: "ok" } },
  { kind: "serving", outcome: { kind: "awaiting-consent", keyUserID: 42 } },
  { kind: "serving", outcome: { kind: "problem", problem: PROBLEM } },
  { kind: "unavailable", problem: PROBLEM },
];

export const STATES: readonly SourceState[] = AVAILABILITIES.flatMap(
  (availability) =>
    [
      { kind: "idle" } as const,
      { kind: "syncing", progress: null } as const,
    ].map((activity) => ({ availability, activity })),
);

export const EVENTS: readonly SourceEvent[] = [
  { _tag: "opened", committed: true },
  { _tag: "opened", committed: false },
  { _tag: "open-failed", problem: PROBLEM },
  { _tag: "sync-started" },
  { _tag: "sync-ended" },
  { _tag: "awaiting-consent", keyUserID: 42, committed: true },
  { _tag: "awaiting-consent", keyUserID: 42, committed: false },
  { _tag: "emptied" },
  { _tag: "build-started" },
  { _tag: "committed" },
  { _tag: "refused", problem: PROBLEM },
  { _tag: "failed", problem: PROBLEM, served: true },
  { _tag: "failed", problem: PROBLEM, served: false },
  { _tag: "finished", changed: true },
  { _tag: "finished", changed: false },
];

const nameOf = (event: SourceEvent) => {
  switch (event._tag) {
    case "opened":
    case "awaiting-consent":
      return `${event._tag}(${event.committed ? "committed" : "empty"})`;
    case "failed":
      return `failed(${event.served ? "served" : "not served"})`;
    case "finished":
      return `finished(${event.changed ? "changed" : "unchanged"})`;
    default:
      return event._tag;
  }
};

const cell = (state: SourceState, event: SourceEvent) => {
  const next = transition(state, event);
  const commands = next.commands
    .map((command) =>
      command._tag === "publish"
        ? `publish ${command.event._tag}`
        : command._tag === "admit"
          ? `admit ${command.open ? "open" : "closed"}`
          : "warn",
    )
    .join(", ");
  return `${describe(next.state)}${commands ? ` (${commands})` : ""}`;
};

export const renderTable = () =>
  [
    `| state \\ event | ${EVENTS.map(nameOf).join(" | ")} |`,
    `|---|${EVENTS.map(() => "---").join("|")}|`,
    ...STATES.map(
      (state) =>
        `| ${describe(state)} | ${EVENTS.map((event) => cell(state, event)).join(" | ")} |`,
    ),
  ].join("\n");
