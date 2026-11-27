export interface HookSpan {
  readonly scope: string;
  readonly name: string;
  readonly ms: number;
}

export interface TestTiming {
  readonly name: string;
  readonly state: string;
  readonly ms: number;
}

export interface ModuleTiming {
  readonly file: string;
  readonly project: string;
  readonly ms: number;
  readonly collectMs: number;
  readonly setupMs: number;
  readonly prepareMs: number;
  readonly hookMs: number;
  readonly eachHookMs: number;
  readonly testMs: number;
  readonly hooks: readonly HookSpan[];
  readonly tests: readonly TestTiming[];
}

export interface RunTimings {
  readonly ms: number;
  readonly modules: readonly ModuleTiming[];
}

export const EACH_TEST = "(each test)";

const slowestFirst = <T extends { readonly ms: number }>(items: Iterable<T>) =>
  [...items].sort((a, b) => b.ms - a.ms);

export function hookTotals(spans: readonly HookSpan[]): HookSpan[] {
  const totals = new Map<string, HookSpan>();
  for (const span of spans) {
    const key = JSON.stringify([span.name, span.scope]);
    const ms = (totals.get(key)?.ms ?? 0) + span.ms;
    totals.set(key, { scope: span.scope, name: span.name, ms });
  }
  return slowestFirst(totals.values());
}

export function moduleTiming(
  module: Omit<
    ModuleTiming,
    "hookMs" | "eachHookMs" | "testMs" | "hooks" | "tests"
  >,
  spans: readonly HookSpan[],
  tests: readonly TestTiming[],
): ModuleTiming {
  const hooks = hookTotals(spans);
  const total = (each: boolean) =>
    hooks
      .filter((hook) => (hook.scope === EACH_TEST) === each)
      .reduce((sum, hook) => sum + hook.ms, 0);
  return {
    ...module,
    hookMs: total(false),
    eachHookMs: total(true),
    testMs: tests.reduce((sum, test) => sum + test.ms, 0),
    hooks,
    tests: slowestFirst(tests),
  };
}

export function runTimings(modules: readonly ModuleTiming[]): RunTimings {
  return {
    ms: modules.reduce((sum, module) => sum + module.ms, 0),
    modules: slowestFirst(modules),
  };
}
