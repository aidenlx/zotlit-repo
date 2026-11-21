// The Land Queue: the machine-wide, first-come-first-served line in which one
// land at a time rebases, gates, and pushes. It is an `Admission` of the
// Desktop Slot machinery (ADR 0077, ADR 0078) with one slot and no Memory
// Gate, so a land that dies leaves a turn the next waiter takes over, as a dead
// Desktop Slot holder does.
//
// The state lives beside the desktop state, in `landStateDir()`:
//
//   queue/              the queue and the one Land Turn
//   waits.jsonl         one line per land: its wait in the queue and outcome
//   logs/               the full log of each land
//   e2e/                the End-to-end Run after each land (lib/land-e2e.ts)

import type { Admission } from "#desktop-slot";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { desktopStateDir } from "@zotlit/config/memory-gate";

import { findLiveHolder } from "#desktop-slot";

/** Holds the token of the Land Turn; the pre-push hook reads it. */
export const LAND_TURN_ENV = "ZOTLIT_LAND_TURN";

/** The per-user state directory of the Land Queue and its logs. */
export function landStateDir(): string {
  return join(desktopStateDir(), "land");
}

/** The admission of the Land Queue: one turn for every land into the trunk. */
export function landAdmission(): Admission {
  return {
    dir: () => join(landStateDir(), "queue"),
    slots: () => 1,
    tokenEnv: LAND_TURN_ENV,
    memoryGate: false,
    display: false,
    slotName: "Land Turn",
    queueName: "Land Queue",
  };
}

/** Whether `token` names a land that holds its turn now. */
export async function isLandTurn(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return (
    (await findLiveHolder(token, { dir: landAdmission().dir() })) !== undefined
  );
}

/** One line of the wait log. */
export interface LandWaitRecord {
  /** The task branch. */
  source: string;
  worktree: string;
  enqueuedAt: string;
  /** Absent when the land never got its turn. */
  admittedAt?: string;
  /** From enqueue to admission, or to the Admission Deadline. */
  waitMs: number;
  outcome: "landed" | "failed" | "blocked";
  /** The step that failed. */
  step?: string;
  /** How many times the land fetched, rebased, and gated in its turn. */
  attempts?: number;
  /** Each CI check of the record PR that the land waited for to its end. */
  ci?: LandCiRun[];
  finishedAt: string;
}

/** One CI check of a record PR head, as the land saw it end. */
export interface LandCiRun {
  commit: string;
  /** `success`, or how the job failed. */
  conclusion: string;
  /** The page of the job. */
  url: string;
  /** How long the land waited for the check, from the push of the head. */
  waitMs: number;
  /** How long the job waited for a runner. */
  queueMs?: number;
  /** How long the job ran on its runner. */
  runMs?: number;
}

export function landWaitLog(): string {
  return join(landStateDir(), "waits.jsonl");
}

export async function recordLandWait(
  record: LandWaitRecord,
  path: string = landWaitLog(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`);
}
