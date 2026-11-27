import type { Admission } from "#desktop-slot";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { desktopStateDir } from "@zotlit/config/memory-gate";

import { findLiveHolder } from "#desktop-slot";

export const LAND_TURN_ENV = "ZOTLIT_LAND_TURN";

export function landStateDir(): string {
  return join(desktopStateDir(), "land");
}

export function landAdmission(): Admission {
  return {
    dir: () => join(landStateDir(), "queue"),
    tokenEnv: LAND_TURN_ENV,
    memoryGate: false,
    display: false,
    slotName: "Land Turn",
    queueName: "Land Queue",
  };
}

export async function isLandTurn(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return (
    (await findLiveHolder(token, { dir: landAdmission().dir() })) !== undefined
  );
}

export interface LandWaitRecord {
  source: string;
  worktree: string;
  enqueuedAt: string;
  admittedAt?: string;
  waitMs: number;
  outcome: "landed" | "draft" | "failed" | "blocked";
  step?: string;
  attempts?: number;
  ci?: LandCiRun[];
  finishedAt: string;
}

export interface LandCiRun {
  commit: string;
  conclusion: string;
  url: string;
  waitMs: number;
  queueMs?: number;
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
