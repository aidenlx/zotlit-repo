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
import type { HookSpan, ModuleTiming } from "./run-timings.ts";
import { EACH_TEST, moduleTiming, runTimings } from "./run-timings.ts";

export default class E2eReporter extends DefaultReporter {
  readonly #directory = e2eResultsDir();
  readonly #log = resolve(this.#directory, "console.log");
  readonly #captures: Promise<void>[] = [];
  readonly #hookStarts = new Map<string, number>();
  readonly #hookSpans = new Map<string, HookSpan[]>();
  readonly #timings: ModuleTiming[] = [];

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
    const diagnostic = module.diagnostic();
    this.#timings.push(
      moduleTiming(
        {
          file: this.relative(module.moduleId),
          project: module.project.name,
          ms: Math.round(diagnostic.duration),
          collectMs: Math.round(diagnostic.collectDuration),
          setupMs: Math.round(diagnostic.setupDuration),
          prepareMs: Math.round(diagnostic.prepareDuration),
        },
        this.#hookSpans.get(module.moduleId) ?? [],
        Array.from(module.children.allTests(), (test) => ({
          name: test.fullName,
          state: test.result().state,
          ms: Math.round(test.diagnostic()?.duration ?? 0),
        })),
      ),
    );
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
    this.#hookStarts.set(hookKey(hook), performance.now());
    reportDesktopProgress(`started ${hook.name} of ${describeEntity(hook)}`);
  }

  override onHookEnd(hook: ReportedHookContext): void {
    super.onHookEnd(hook);
    const key = hookKey(hook);
    const start = this.#hookStarts.get(key);
    this.#hookStarts.delete(key);
    if (start !== undefined) {
      const moduleId = hookModuleId(hook);
      const spans = this.#hookSpans.get(moduleId) ?? [];
      spans.push({
        scope: hookScope(hook),
        name: hook.name,
        ms: Math.round(performance.now() - start),
      });
      this.#hookSpans.set(moduleId, spans);
    }
    reportDesktopProgress(`finished ${hook.name} of ${describeEntity(hook)}`);
  }

  // oxlint-disable-next-line typescript/no-misused-promises -- Vitest awaits each reporter's onTestRunEnd (Reporter.onTestRunEnd returns Awaitable<void>), so the line prints before the run exits
  override async onTestRunEnd(
    testModules: Parameters<DefaultReporter["onTestRunEnd"]>[0],
    unhandledErrors: Parameters<DefaultReporter["onTestRunEnd"]>[1],
    reason: TestRunEndReason,
  ) {
    await Promise.all(this.#captures);
    writeFileSync(
      resolve(this.#directory, "timings.json"),
      `${JSON.stringify(runTimings(this.#timings), null, 2)}\n`,
    );
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

function hookKey(hook: ReportedHookContext): string {
  return `${hook.name} ${hook.entity.id}`;
}

function hookModuleId(hook: ReportedHookContext): string {
  const { entity } = hook;
  return entity.type === "module" ? entity.moduleId : entity.module.moduleId;
}

function hookScope(hook: ReportedHookContext): string {
  const { entity } = hook;
  if (entity.type === "test") return EACH_TEST;
  return entity.type === "module" ? "(file)" : entity.fullName;
}

function describeEntity(hook: ReportedHookContext): string {
  const { entity } = hook;
  return entity.type === "module" ? entity.moduleId : `"${entity.fullName}"`;
}
