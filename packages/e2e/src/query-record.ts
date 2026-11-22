export const THRESHOLDS = {
  slice: { p99Ms: 16, maxMs: 32 },
  cancelMs: 50,
  totalMs: {
    selective: { 10_000: 50, 50_000: 50 },
    other: { 10_000: 150, 50_000: 750 },
  },
} as const satisfies {
  slice: { p99Ms: number; maxMs: number };
  cancelMs: number;
  totalMs: Record<"selective" | "other", Record<number, number>>;
};

export type QueryClass = "selective" | "other" | "all";

export const DATASET_QUERY_SPECS: readonly Pick<
  QueryMeasurement,
  "id" | "class" | "args"
>[] = [
  {
    id: "items-default",
    class: "other",
    args: { from: "items", limit: "100" },
  },
  {
    id: "collection-projection",
    class: "other",
    args: { from: "items", fields: "key,collections", limit: "100" },
  },
  {
    id: "attachments-default",
    class: "other",
    args: { from: "attachments", limit: "100" },
  },
  {
    id: "annotations-default",
    class: "other",
    args: { from: "annotations", limit: "100" },
  },
  {
    id: "relation-tag",
    class: "selective",
    args: {
      filter:
        'annotations.filter(value.tags.contains("methodology")).length > 0',
      limit: "100",
    },
  },
  {
    id: "relation-many-marks",
    class: "other",
    args: {
      from: "items",
      filter:
        'annotations.filter(value.tags.contains("stress-many-marks")).length > 0',
      limit: "100",
    },
  },
  {
    id: "relation-parent-dominant",
    class: "other",
    args: {
      from: "annotations",
      filter: 'item.tags.contains("stress-dominant")',
      limit: "100",
    },
  },
  {
    id: "relation-scan",
    class: "other",
    args: {
      filter: "attachments.filter(value.exists).isEmpty()",
      limit: "100",
    },
  },
  {
    id: "all-attachment-paths",
    class: "all",
    args: { fields: "attachments[].path", limit: "all" },
  },
];

export interface RunSample {
  totalMs: number;
  slices: readonly number[];
  uiGaps?: readonly number[];
  worstSliceReaders: readonly string[];
  answerSteps: readonly number[];
}

export interface QueryMeasurement {
  id: string;
  class: QueryClass;
  args: Readonly<Record<string, string>>;
  returnedCount: number;
  runs: readonly RunSample[];
}

export interface CancelMeasurement {
  delivery: "timer" | "cli" | "unload";
  query: string;
  latencyMs: number;
  transportMs?: number;
  worstSliceMs?: number;
}

export interface MissedCancel {
  delivery: CancelMeasurement["delivery"];
  query: string;
  outcome: string;
}

export interface HeapMeasurement {
  query: string;
  class: QueryClass;
  returnedCount: number;
  peakBytes: number;
  beforeBytes?: number;
  afterAnswerBytes: number;
}

export interface TwoLibraryMeasurement {
  groupItems: number;
  queries: readonly QueryMeasurement[];
  cancels: readonly CancelMeasurement[];
  missedCancels: readonly MissedCancel[];
  complete: boolean;
}

export interface TierMeasurement {
  items: number;
  queries: readonly QueryMeasurement[];
  cancels: readonly CancelMeasurement[];
  missedCancels: readonly MissedCancel[];
  heaps: readonly HeapMeasurement[];
  twoLibraries: TwoLibraryMeasurement | undefined;
}

export interface MeasurementRecord {
  startedAt: string;
  environment: readonly string[];
  tiers: readonly TierMeasurement[];
  notes: readonly string[];
  rawPath: string;
}

export type Status = "passed" | "failed" | "recorded";

export interface Check {
  tier: number;
  kind: "slices" | "answer" | "ui" | "total" | "cancel" | "complete";
  subject: string;
  detail: string;
  status: Status;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)]!;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function totalBudgetMs(
  queryClass: QueryClass,
  items: number,
): number | undefined {
  if (queryClass === "all") return undefined;
  const budgets: Record<number, number> = THRESHOLDS.totalMs[queryClass];
  return budgets[items];
}

const ms = (value: number): string =>
  value >= 100 ? value.toFixed(0) : value.toFixed(1);

function pooledSlices(query: QueryMeasurement): number[] {
  return query.runs.flatMap((run) => run.slices);
}

interface TierPart {
  mark: string;
  queries: readonly QueryMeasurement[];
  cancels: readonly CancelMeasurement[];
  missedCancels: readonly MissedCancel[];
  budgetOf: (query: QueryMeasurement) => number | undefined;
}

function oneLibraryPart(tier: TierMeasurement): TierPart {
  return {
    mark: "",
    queries: tier.queries,
    cancels: tier.cancels,
    missedCancels: tier.missedCancels,
    budgetOf: (query) => totalBudgetMs(query.class, tier.items),
  };
}

function twoLibraryPart(measured: TwoLibraryMeasurement): TierPart {
  return {
    mark: ", two Libraries",
    queries: measured.queries,
    cancels: measured.cancels,
    missedCancels: measured.missedCancels,
    budgetOf: () => undefined,
  };
}

export function evaluateTier(tier: TierMeasurement): Check[] {
  const { items, twoLibraries } = tier;
  return [
    ...evaluatePart(items, oneLibraryPart(tier)),
    ...(twoLibraries ? evaluatePart(items, twoLibraryPart(twoLibraries)) : []),
    ...(twoLibraries?.complete
      ? []
      : [
          {
            tier: items,
            kind: "complete",
            subject: "two Libraries",
            detail:
              "the run stopped before it measured every query and cancel over two Libraries; run the measurement again",
            status: "failed",
          } satisfies Check,
        ]),
  ];
}

function evaluatePart(items: number, part: TierPart): Check[] {
  const checks: Check[] = [];
  for (const query of part.queries) {
    const worker = query.runs.some((run) => run.uiGaps !== undefined);
    const slices = pooledSlices(query);
    const p99 = percentile(slices, 99);
    const max = Math.max(0, ...slices);
    checks.push({
      tier: items,
      kind: "slices",
      subject: query.id,
      detail: `p99 ${ms(p99)} ms (limit ${THRESHOLDS.slice.p99Ms}), max ${ms(max)} ms (limit ${THRESHOLDS.slice.maxMs})`,
      status:
        p99 <= THRESHOLDS.slice.p99Ms && max <= THRESHOLDS.slice.maxMs
          ? "passed"
          : "failed",
    });
    const answerSteps = query.runs.flatMap((run) => run.answerSteps);
    const answerP99 = percentile(answerSteps, 99);
    const answerMax = Math.max(0, ...answerSteps);
    checks.push({
      tier: items,
      kind: "answer",
      subject: query.id,
      detail: `p99 ${ms(answerP99)} ms (limit ${THRESHOLDS.slice.p99Ms}), max ${ms(answerMax)} ms (limit ${THRESHOLDS.slice.maxMs})`,
      status:
        answerP99 <= THRESHOLDS.slice.p99Ms &&
        answerMax <= THRESHOLDS.slice.maxMs
          ? "passed"
          : "failed",
    });
    if (worker) {
      const gaps = query.runs.flatMap((run) => run.uiGaps ?? []);
      const complete = query.runs.every((run) => (run.uiGaps?.length ?? 0) > 0);
      const p99 = percentile(gaps, 99);
      const max = Math.max(0, ...gaps);
      checks.push({
        tier: items,
        kind: "ui",
        subject: query.id,
        detail: `renderer p99 ${ms(p99)} ms (limit ${THRESHOLDS.slice.p99Ms}), max ${ms(max)} ms (limit ${THRESHOLDS.slice.maxMs})${complete ? "" : "; missing samples"}`,
        status:
          complete &&
          p99 <= THRESHOLDS.slice.p99Ms &&
          max <= THRESHOLDS.slice.maxMs
            ? "passed"
            : "failed",
      });
    }
    const total = median(query.runs.map((run) => run.totalMs));
    const budget = part.budgetOf(query);
    checks.push({
      tier: items,
      kind: "total",
      subject: query.id,
      detail:
        budget === undefined
          ? `median ${ms(total)} ms`
          : `median ${ms(total)} ms (budget ${budget})`,
      status:
        budget === undefined
          ? "recorded"
          : total <= budget
            ? "passed"
            : "failed",
    });
  }
  for (const cancel of part.cancels) {
    checks.push({
      tier: items,
      kind: "cancel",
      subject: `${cancel.delivery}: ${cancel.query}`,
      detail: `${ms(cancel.latencyMs)} ms (limit ${THRESHOLDS.cancelMs})`,
      status: cancel.latencyMs <= THRESHOLDS.cancelMs ? "passed" : "failed",
    });
  }
  const missed = Map.groupBy(part.missedCancels, (cancel) => cancel.delivery);
  for (const [delivery, requests] of missed) {
    if (part.cancels.some((cancel) => cancel.delivery === delivery)) continue;
    checks.push({
      tier: items,
      kind: "cancel",
      subject: `${delivery}: not measured${part.mark}`,
      detail: `none of ${requests.length} cancel requests reached a running query (${requests.map((request) => request.outcome).join(", ")}); run the measurement again`,
      status: "failed",
    });
  }
  return checks;
}

export function failedEngineChecks(
  tier: TierMeasurement,
  queryIDs: ReadonlySet<string>,
): Check[] {
  return evaluateTier(tier).filter(
    (check) =>
      check.status === "failed" &&
      (check.kind === "slices" ||
        check.kind === "ui" ||
        check.kind === "total") &&
      queryIDs.has(check.subject),
  );
}

const MARK: Record<Status, string> = {
  passed: "pass",
  failed: "**FAIL**",
  recorded: "recorded",
};

const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

const count = (value: number): string => value.toLocaleString("en-US");

function table(header: readonly string[], rows: readonly string[][]): string {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function partTables(items: number, part: TierPart): string[] {
  const checks = evaluatePart(items, part);
  const statusOf = (kind: Check["kind"], subject: string): Status =>
    checks.find((check) => check.kind === kind && check.subject === subject)!
      .status;

  const tables = [
    table(
      [
        "Query",
        "Class",
        "Rows",
        "Median total (ms)",
        "Budget (ms)",
        "Total",
        "Slices",
        "p99 slice (ms)",
        "Max slice (ms)",
        "Slice limits",
        "Worst slice of each run (ms)",
        "Answer steps",
        "Longest answer step (ms)",
        "Answer limits",
        "UI p99 (ms)",
        "UI max (ms)",
        "UI limits",
      ],
      part.queries.map((query) => {
        const slices = pooledSlices(query);
        const answerSteps = query.runs.flatMap((run) => run.answerSteps);
        const budget = part.budgetOf(query);
        return [
          `\`${query.id}\``,
          query.class,
          count(query.returnedCount),
          ms(median(query.runs.map((run) => run.totalMs))),
          budget === undefined ? "-" : String(budget),
          MARK[statusOf("total", query.id)],
          count(slices.length),
          ms(percentile(slices, 99)),
          ms(Math.max(0, ...slices)),
          MARK[statusOf("slices", query.id)],
          query.runs.map((run) => ms(Math.max(0, ...run.slices))).join(", "),
          count(answerSteps.length),
          ms(Math.max(0, ...answerSteps)),
          MARK[statusOf("answer", query.id)],
          query.runs[0]?.uiGaps
            ? ms(
                percentile(
                  query.runs.flatMap((run) => run.uiGaps ?? []),
                  99,
                ),
              )
            : "-",
          query.runs[0]?.uiGaps
            ? ms(Math.max(0, ...query.runs.flatMap((run) => run.uiGaps ?? [])))
            : "-",
          query.runs[0]?.uiGaps ? MARK[statusOf("ui", query.id)] : "-",
        ];
      }),
    ),
  ];
  if (part.cancels.length > 0) {
    tables.push(
      table(
        [
          "Cancel request",
          "Query",
          "Request to settlement (ms)",
          `Limit ${THRESHOLDS.cancelMs} ms`,
          "CLI transport (ms)",
          "Worst slice (ms)",
        ],
        part.cancels.map((cancel) => [
          cancel.delivery,
          `\`${cancel.query}\``,
          ms(cancel.latencyMs),
          MARK[statusOf("cancel", `${cancel.delivery}: ${cancel.query}`)],
          cancel.transportMs === undefined ? "-" : ms(cancel.transportMs),
          cancel.worstSliceMs === undefined ? "-" : ms(cancel.worstSliceMs),
        ]),
      ),
    );
  }
  return tables;
}

function tierSection(tier: TierMeasurement): string {
  const parts = [
    `### ${count(tier.items)} Items`,
    ...partTables(tier.items, oneLibraryPart(tier)),
  ];

  if (tier.heaps.length > 0) {
    parts.push(
      table(
        [
          "Peak heap",
          "Rows",
          "Worker baseline (MB)",
          "Worker peak (MB)",
          "MB for each 10,000 rows",
          "After the answer (MB)",
        ],
        tier.heaps.map((heap) => [
          `\`${heap.query}\``,
          count(heap.returnedCount),
          heap.beforeBytes === undefined ? "-" : megabytes(heap.beforeBytes),
          megabytes(heap.peakBytes),
          heap.class === "all" && heap.returnedCount > 0
            ? megabytes((heap.peakBytes / heap.returnedCount) * 10_000)
            : "-",
          megabytes(heap.afterAnswerBytes),
        ]),
      ),
    );
  }

  const { twoLibraries } = tier;
  if (twoLibraries) {
    parts.push(
      `#### Two Libraries: ${count(tier.items)} Items in My Library and ${count(twoLibraries.groupItems)} Items in the group Library`,
      ...partTables(tier.items, twoLibraryPart(twoLibraries)),
    );
  }
  return parts.join("\n\n");
}

export function formatSummary(record: MeasurementRecord): string {
  const checks = record.tiers.flatMap((tier) => evaluateTier(tier));
  const failed = checks.filter((check) => check.status === "failed");
  const thresholds = checks.filter((check) => check.status !== "recorded");

  const verdict =
    failed.length === 0
      ? `**Result: passed.** All ${thresholds.length} thresholds hold.`
      : `**Result: FAILED.** ${failed.length} of ${thresholds.length} thresholds failed.`;

  const parts = [
    "## ZotLit Query measurement record",
    [
      `Measured ${record.startedAt} in a visible Obsidian window.`,
      ...record.environment,
    ].join("\n"),
    verdict,
    `Thresholds: 99th percentile slice at most ${THRESHOLDS.slice.p99Ms} ms and no slice above ${THRESHOLDS.slice.maxMs} ms, for execution slices and encoding steps in either process, and for renderer timer gaps when execution uses workers; cancel request to settlement within ${THRESHOLDS.cancelMs} ms; median \`limit 100\` total of five runs within ${THRESHOLDS.totalMs.selective[10_000]} ms for selective queries, and ${THRESHOLDS.totalMs.other[10_000]} ms (10,000 Items) or ${THRESHOLDS.totalMs.other[50_000]} ms (50,000 Items) for the others. Totals at 100,000 Items, of \`limit=all\`, and of the queries over two Libraries are recorded.`,
  ];
  if (failed.length > 0) {
    parts.push(
      [
        "### Failed thresholds",
        ...failed.map(
          (check) =>
            `- ${count(check.tier)} Items, ${check.kind}, \`${check.subject}\`: ${check.detail}`,
        ),
      ].join("\n"),
    );
  }
  if (record.notes.length > 0) {
    parts.push(
      ["### Findings", ...record.notes.map((note) => `- ${note}`)].join("\n"),
    );
  }
  parts.push(...record.tiers.map((tier) => tierSection(tier)));
  parts.push(`Raw output: \`${record.rawPath}\``);
  return `${parts.join("\n\n")}\n`;
}
