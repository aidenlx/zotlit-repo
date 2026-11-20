export type StartupMode = "cold" | "warm";

export interface PluginStartup {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly runs: readonly number[];
}

export type StartupSummary = Record<
  string,
  Partial<Record<StartupMode, PluginStartup>>
>;

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

export function startupCheck(
  summary: StartupSummary,
  budgets: Record<string, number | undefined>,
): { lines: string[]; failures: string[] } {
  const lines: string[] = [];
  const failures: string[] = [];
  for (const [id, modes] of Object.entries(summary)) {
    const { cold, warm } = modes;
    const budget = budgets[id];
    lines.push(
      `${id}: warm median ${warm?.median ?? "?"} ms, cold median ${cold?.median ?? "?"} ms, ${budget === undefined ? "no warm budget" : `warm budget ${budget} ms`}`,
    );
    if (budget === undefined) continue;
    if (!warm) {
      failures.push(`${id}: no warm measurement to compare with ${budget} ms`);
    } else if (warm.median > budget) {
      failures.push(
        `${id}: warm median ${warm.median} ms is above its budget of ${budget} ms by ${Math.round((warm.median - budget) * 10) / 10} ms`,
      );
    }
  }
  return { lines, failures };
}
