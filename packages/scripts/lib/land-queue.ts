// The Land Queue: the machine-wide, first-come-first-served line in which one
// land at a time rebases, gates, and pushes. It is an `Admission` of the
// Desktop Slot machinery (ADR 0077, ADR 0078) with one slot and no Memory
// Gate, so a land that dies leaves a turn the next waiter takes over, as a dead
// Desktop Slot holder does.
//
// The state lives beside the desktop state, in `landStateDir()`:
//
//   queue-<target>/     the queue and the one turn of each target branch
//   waits.jsonl         one line per land: its wait in the queue and outcome
//   logs/               the full log of each land
//   e2e/                the End-to-end Run after each land (lib/land-e2e.ts)

import type { Admission } from "#desktop-slot";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { desktopStateDir } from "@zotlit/config/memory-gate";

import { findLiveHolder } from "#desktop-slot";

/** The branches `land` pushes to. */
export type LandTarget = "next" | "main";

/** Holds the token of the Land Turn; the pre-push hook reads it. */
export const LAND_TURN_ENV = "ZOTLIT_LAND_TURN";

/** The per-user state directory of the Land Queue and its logs. */
export function landStateDir(): string {
  return join(desktopStateDir(), "land");
}

/**
 * The admission of `target`. Each target branch has its own queue, so a
 * release gate of `main` does not hold up the lands into `next`.
 */
export function landAdmission(target: LandTarget): Admission {
  return {
    dir: () => join(landStateDir(), `queue-${target}`),
    slots: () => 1,
    tokenEnv: LAND_TURN_ENV,
    memoryGate: false,
    display: false,
    slotName: "Land Turn",
    queueName: `Land Queue of ${target}`,
  };
}

/** Whether `token` names a land that holds its turn now, for either target. */
export async function isLandTurn(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  for (const target of ["next", "main"] as const) {
    const dir = landAdmission(target).dir();
    if (await findLiveHolder(token, { dir })) return true;
  }
  return false;
}

/** One line of the wait log. */
export interface LandWaitRecord {
  target: LandTarget;
  /** The task branch, or the commit for a land into `main`. */
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
  finishedAt: string;
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
