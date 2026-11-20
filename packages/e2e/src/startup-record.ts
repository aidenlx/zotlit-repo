export const STARTUP_MODES = ["daily", "update", "reload"] as const;
export type StartupMode = (typeof STARTUP_MODES)[number];

export interface PluginStartup {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly runs: readonly number[];
}

export interface ModeStartup {
  readonly plugin: PluginStartup;
  readonly layoutToSnapshot?: PluginStartup;
  readonly layoutToCallbacksDone?: PluginStartup;
  readonly snapshotCapped: number;
}

export type StartupSummary = Record<
  string,
  Partial<Record<StartupMode, ModeStartup>>
>;

export type StartupBudgets = Record<
  string,
  Partial<Record<StartupMode, number | undefined>>
>;

export const BUSY_LOAD_LIMIT = 10;

export function busyReason(
  loadAverage: number,
  limit = BUSY_LOAD_LIMIT,
): string | undefined {
  if (loadAverage < limit) return undefined;
  return `the machine is busy: the 1-minute load average is ${loadAverage.toFixed(1)}, at or above ${limit}, so a start-up time would measure the other work. Nothing was measured; run again when the machine is idle.`;
}

export function pluginStartupMs(
  devStartupJson: string,
  ids: readonly string[],
): Record<string, number> {
  const { durations } = JSON.parse(devStartupJson) as {
    durations?: Record<string, number>;
  };
  return Object.fromEntries(
    ids.map((id) => {
      const ms = durations?.[`communityPlugins.${id}`];
      if (typeof ms !== "number") {
        throw new Error(
          `dev:startup reports no communityPlugins.${id}: the plugin did not load`,
        );
      }
      return [id, ms];
    }),
  );
}

export function summarize(runs: readonly number[]): PluginStartup {
  const sorted = runs.toSorted((a, b) => a - b);
  const middle = sorted.length / 2;
  const median =
    sorted.length % 2
      ? sorted[Math.floor(middle)]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return {
    median: Math.round(median * 10) / 10,
    min: sorted[0]!,
    max: sorted.at(-1)!,
    runs,
  };
}

const MODE_BUDGET_NAME: Record<StartupMode, string> = {
  daily: "startupDailyMs",
  update: "startupUpdateMs",
  reload: "startupWarmMs",
};

export function startupCheck(
  summary: StartupSummary,
  budgets: StartupBudgets,
): { lines: string[]; failures: string[] } {
  const lines: string[] = [];
  const failures: string[] = [];
  for (const [id, modes] of Object.entries(summary)) {
    for (const mode of STARTUP_MODES) {
      const measured = modes[mode];
      const budget = budgets[id]?.[mode];
      if (!measured) {
        if (budget !== undefined) {
          failures.push(
            `${id} ${mode}: no measurement to compare with ${budget} ms`,
          );
        }
        continue;
      }
      const snapshot = measured.layoutToSnapshot
        ? `, layout ready to snapshot gone ${measured.layoutToSnapshot.median} ms`
        : "";
      lines.push(
        `${id} ${mode}: median ${measured.plugin.median} ms (${measured.plugin.min}-${measured.plugin.max})${snapshot}, ${budget === undefined ? `no ${MODE_BUDGET_NAME[mode]}` : `${MODE_BUDGET_NAME[mode]} ${budget} ms`}`,
      );
      if (budget !== undefined && measured.plugin.median > budget) {
        failures.push(
          `${id} ${mode}: median ${measured.plugin.median} ms is above its budget of ${budget} ms by ${Math.round((measured.plugin.median - budget) * 10) / 10} ms`,
        );
      }
    }
  }
  return { lines, failures };
}
