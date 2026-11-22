import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FixtureLayout } from "./layout.ts";

export interface PairedRunState {
  pid: number;
  debuggerPort?: number;
}

export function pairedRunStatePath(layout: FixtureLayout): string {
  return join(layout.root, "paired-zotero.json");
}

export async function writePairedRunState(
  layout: FixtureLayout,
  state: PairedRunState,
): Promise<void> {
  await writeFile(
    pairedRunStatePath(layout),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

export async function readPairedRunState(
  layout: FixtureLayout,
): Promise<PairedRunState | null> {
  const source = await readFile(pairedRunStatePath(layout), "utf-8").catch(
    () => null,
  );
  if (source === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { pid, debuggerPort } = parsed as Record<string, unknown>;
  if (typeof pid !== "number") return null;
  if (debuggerPort !== undefined && typeof debuggerPort !== "number") {
    return null;
  }
  return debuggerPort === undefined ? { pid } : { pid, debuggerPort };
}

export async function clearPairedRunState(
  layout: FixtureLayout,
): Promise<void> {
  await rm(pairedRunStatePath(layout), { force: true });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function livePairedZotero(
  layout: FixtureLayout,
  { isAlive = processAlive }: { isAlive?: (pid: number) => boolean } = {},
): Promise<PairedRunState | null> {
  const reported = await readPairedRunState(layout);
  if (reported === null) return null;
  return isAlive(reported.pid) ? reported : null;
}
