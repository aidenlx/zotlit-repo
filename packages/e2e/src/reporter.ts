import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { DefaultReporter } from "vitest/node";
import type {
  ReportedHookContext,
  TestCase,
  TestModule,
  TestModuleState,
  TestRunEndReason,
} from "vitest/node";

import {
  paintAfterFailure,
  reportDesktopProgress,
} from "@zotlit/scripts/desktop-slot";

import { E2E_RESULTS_ROOT, e2eResultsDir } from "./results-dir.ts";

const KEPT_RUNS = 10;

export default class E2eReporter extends DefaultReporter {
  readonly #directory = e2eResultsDir();
  readonly #log = resolve(this.#directory, "console.log");

  override onInit(...args: Parameters<DefaultReporter["onInit"]>): void {
    super.onInit(...args);
    mkdirSync(this.#directory, { recursive: true });
    writeFileSync(this.#log, "");
    this.#pointLatest();
    this.#pruneRuns();
    this.log(`E2E evidence: ${this.#directory}`);
  }

  #pointLatest(): void {
    const draft = resolve(E2E_RESULTS_ROOT, `latest.${process.pid}`);
    rmSync(draft, { force: true });
    symlinkSync(basename(this.#directory), draft, "junction");
    renameSync(draft, resolve(E2E_RESULTS_ROOT, "latest"));
  }

  #pruneRuns(): void {
    for (const file of ["results.json", "console.log", "paired-startup.log"]) {
      rmSync(resolve(E2E_RESULTS_ROOT, file), { force: true });
    }
    const runs = readdirSync(E2E_RESULTS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{4}-/.test(entry.name))
      .map((entry) => entry.name)
      .toSorted();
    for (const run of runs.slice(0, -KEPT_RUNS)) {
      if (run === basename(this.#directory)) continue;
      rmSync(resolve(E2E_RESULTS_ROOT, run), { recursive: true, force: true });
    }
  }

  override onUserConsoleLog(
    ...[log]: Parameters<DefaultReporter["onUserConsoleLog"]>
  ): void {
    appendFileSync(this.#log, `[${log.type}] ${log.content}\n`);
  }

  onTestModuleStart(
    module: Parameters<DefaultReporter["onTestModuleEnd"]>[0],
  ): void {
    reportDesktopProgress(`started ${this.relative(module.moduleId)}`);
    this.log(`Running ${this.relative(module.moduleId)}`);
  }

  override onTestModuleCollected(module: TestModule): void {
    super.onTestModuleCollected(module);
    reportDesktopProgress(`collected ${this.relative(module.moduleId)}`);
  }

  override onTestModuleEnd(module: TestModule): void {
    super.onTestModuleEnd(module);
    reportDesktopProgress(`finished ${this.relative(module.moduleId)}`);
  }

  override onTestCaseReady(test: TestCase): void {
    super.onTestCaseReady(test);
    reportDesktopProgress(`started test "${test.fullName}"`);
  }

  override onTestCaseResult(test: TestCase): void {
    super.onTestCaseResult(test);
    reportDesktopProgress(`finished test "${test.fullName}"`);
  }

  override onHookStart(hook: ReportedHookContext): void {
    super.onHookStart(hook);
    reportDesktopProgress(`started ${hook.name} of ${describeEntity(hook)}`);
  }

  override onHookEnd(hook: ReportedHookContext): void {
    super.onHookEnd(hook);
    reportDesktopProgress(`finished ${hook.name} of ${describeEntity(hook)}`);
  }

  // oxlint-disable-next-line typescript/no-misused-promises -- Vitest awaits each reporter's onTestRunEnd (Reporter.onTestRunEnd returns Awaitable<void>), so the line prints before the run exits
  override async onTestRunEnd(
    testModules: Parameters<DefaultReporter["onTestRunEnd"]>[0],
    unhandledErrors: Parameters<DefaultReporter["onTestRunEnd"]>[1],
    reason: TestRunEndReason,
  ) {
    super.onTestRunEnd(testModules, unhandledErrors, reason);
    if (reason !== "failed") return;
    const line = await paintAfterFailure();
    if (line) this.error(line);
  }

  protected override printTestCase(
    state: TestModuleState,
    test: TestCase,
  ): void {
    if (test.result().state === "failed") super.printTestCase(state, test);
  }
}

function describeEntity(hook: ReportedHookContext): string {
  const { entity } = hook;
  return entity.type === "module" ? entity.moduleId : `"${entity.fullName}"`;
}
