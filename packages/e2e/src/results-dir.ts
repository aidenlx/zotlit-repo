import { regex } from "arkregex";
import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, relative, resolve } from "node:path";
export const E2E_RESULTS_ENV = "ZOTLIT_E2E_RESULTS";

export const E2E_RESULTS_ROOT = resolve(
  import.meta.dirname,
  "../../../.scratch/e2e-results",
);

export function newE2eResultsDir(): string {
  const time = Temporal.Now.instant()
    .toString()
    .replaceAll(":", "-")
    .slice(0, 19);
  return resolve(E2E_RESULTS_ROOT, `${time}-${process.pid}`);
}

export function e2eResultsDir(): string {
  return (process.env[E2E_RESULTS_ENV] ||= newE2eResultsDir());
}

const KEPT_RUNS = 10;
const RUN_DIRECTORY = regex("^\\d{4}-");

export function publishE2eResultsDir(directory: string): void {
  mkdirSync(E2E_RESULTS_ROOT, { recursive: true });
  const draft = resolve(E2E_RESULTS_ROOT, `latest.${process.pid}`);
  rmSync(draft, { force: true });
  if (process.platform === "win32") {
    symlinkSync(resolve(directory), draft, "junction");
  } else {
    symlinkSync(relative(E2E_RESULTS_ROOT, directory), draft, "dir");
  }
  renameSync(draft, resolve(E2E_RESULTS_ROOT, "latest"));
  for (const file of ["results.json", "console.log", "paired-startup.log"]) {
    rmSync(resolve(E2E_RESULTS_ROOT, file), { force: true });
  }
  const runs = readdirSync(E2E_RESULTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RUN_DIRECTORY.test(entry.name))
    .map((entry) => entry.name)
    .toSorted();
  for (const run of runs.slice(0, -KEPT_RUNS)) {
    if (run === basename(directory)) continue;
    rmSync(resolve(E2E_RESULTS_ROOT, run), { recursive: true, force: true });
  }
}
