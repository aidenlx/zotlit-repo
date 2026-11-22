import { mkdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { relative, resolve } from "node:path";
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

export function pointLatestResult(directory: string): void {
  mkdirSync(E2E_RESULTS_ROOT, { recursive: true });
  const draft = resolve(E2E_RESULTS_ROOT, `latest.${process.pid}`);
  rmSync(draft, { force: true });
  if (process.platform === "win32") {
    symlinkSync(resolve(directory), draft, "junction");
  } else {
    symlinkSync(relative(E2E_RESULTS_ROOT, directory), draft, "dir");
  }
  renameSync(draft, resolve(E2E_RESULTS_ROOT, "latest"));
}
