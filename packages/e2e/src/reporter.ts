import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ReportedHookContext,
  TestCase,
  TestModule,
  TestModuleState,
  TestRunEndReason,
} from "vitest/node";
import { DefaultReporter } from "vitest/node";

import {
  paintAfterFailure,
  reportDesktopProgress,
} from "@zotlit/scripts/desktop-slot";

import { captureContainerWindows } from "./container-screenshot.ts";
import { e2eResultsDir, publishE2eResultsDir } from "./results-dir.ts";

export default class E2eReporter extends DefaultReporter {
  readonly #directory = e2eResultsDir();
  readonly #log = resolve(this.#directory, "console.log");
  readonly #captures: Promise<void>[] = [];

  override onInit(...args: Parameters<DefaultReporter["onInit"]>): void {
    super.onInit(...args);
    mkdirSync(this.#directory, { recursive: true });
    writeFileSync(this.#log, "");
    if (!process.env.ZOTLIT_RUN_CONTAINER)
      publishE2eResultsDir(this.#directory);
    this.log(`E2E evidence: ${this.#directory}`);
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
    if (process.env.ZOTLIT_RUN_CONTAINER && test.result().state === "failed") {
      this.#captures.push(
        captureContainerWindows(this.#directory, test.id).catch(
          (error: unknown) => {
            this.log(
              `Could not capture a Run Container window: ${String(error)}`,
            );
          },
        ),
      );
    }
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
    await Promise.all(this.#captures);
    super.onTestRunEnd(testModules, unhandledErrors, reason);
    if (reason !== "failed" || process.env.ZOTLIT_RUN_CONTAINER) return;
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
