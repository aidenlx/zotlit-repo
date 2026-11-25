import type { QueryFile } from "#core/query-view/query-file.ts";
import type {
  QueryViewResult,
  QueryViewRow,
} from "#desktop/item-query/query-view.ts";
import { DateTime, Effect } from "effect";
// oxlint-disable-next-line no-restricted-imports -- the production scheduler of a Query Job, as job.ts provides it.
import { Scheduler } from "effect";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import {
  ItemQueryDatabase,
  ItemQueryStatementObserver,
} from "@zotlit/db/item-query";
import type { ItemQueryReader, StatementRun } from "@zotlit/db/item-query";
import {
  ItemQueryScheduler,
  ItemQuerySliceObserver,
  planItemFilter,
} from "@zotlit/item-query";
import { toInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";

import type { VaultValue } from "./table-notes.ts";

import { parseQueryFile } from "#core/query-view/query-file.ts";
import { answerView } from "#desktop/item-query/answer.ts";
import { QUERY_COMMAND } from "#desktop/item-query/contract.ts";
import { ViewPlanner } from "#desktop/query-view/view-plan/view-plan.ts";

const WORKSPACE = resolve(import.meta.dirname, "../../../../..");
const SCRATCH = join(WORKSPACE, ".scratch", "mixed-query-bench");
const SIZES = (process.env.ZOTLIT_BENCH_SIZES ?? "10000,50000,100000")
  .split(",")
  .map(Number);
const RUNS = Number(process.env.ZOTLIT_BENCH_RUNS ?? 5);
const REAL = process.env.ZOTLIT_BENCH_REAL?.replace(/^~/, homedir());
const OUT = process.env.ZOTLIT_BENCH_OUT ?? join(SCRATCH, "results.json");
const LIMIT = 100;
const COVERAGES = [0.1, 0.5, 1] as const;
const SELECTIVITIES = [0.01, 0.5] as const;

const ZOTERO_FILTERS = {
  candidates: {
    0.01: 'tags.contains("bench-p01")',
    0.5: 'tags.contains("bench-p50")',
  },
  scan: {
    0.01: "/[2-4][2-4]$/.matches(key)",
    0.5: "/[2-9A-H]$/.matches(key)",
  },
} as const;
type Flavor = keyof typeof ZOTERO_FILTERS;

const SCENARIOS = {
  "0 zotero only": { vault: null, sort: [["title", "ASC"]] },
  "1 vault include": {
    vault: 'vault["status"] == "read"',
    sort: [["title", "ASC"]],
  },
  "2 vault exclude": {
    vault: 'vault["status"] != "read"',
    sort: [["title", "ASC"]],
  },
  "3 vault sort": { vault: null, sort: [["vault.rating", "DESC"]] },
  "4 vault sort+filter": {
    vault: 'vault["status"] == "read"',
    sort: [["vault.rating", "DESC"]],
  },
  "5 zotero then vault sort": {
    vault: null,
    sort: [
      ["date", "DESC"],
      ["vault.rating", "DESC"],
    ],
  },
} as const satisfies Record<
  string,
  { vault: string | null; sort: readonly (readonly [string, string])[] }
>;
type ScenarioName = keyof typeof SCENARIOS;

interface Library {
  name: string;
  path: string;
  keys: string[];
}

function stressLibrary(count: number): Library {
  const root = join(SCRATCH, `stress-${count}`);
  const path = join(root, "zotero-data", "zotero.sqlite");
  const ready = join(root, "bench-ready");
  if (!existsSync(ready)) {
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { buildFixture, getFixtureLayout } from "@zotlit/scripts/fixture";
         const layout = getFixtureLayout(process.argv[1]);
         await buildFixture(layout, { stressLibraryItemCount: Number(process.argv[2]) });
         if (layout.databasePath !== process.argv[3]) throw new Error(layout.databasePath);`,
        root,
        String(count),
        path,
      ],
      { cwd: join(WORKSPACE, "packages", "scripts"), stdio: "inherit" },
    );
    seedBenchTags(path);
    writeFileSync(ready, "");
  }
  return { name: `stress ${count / 1000}k`, path, keys: topLevelKeys(path) };
}

function realLibrary(source: string): Library {
  const path = join(SCRATCH, "real", "zotero.sqlite");
  rmSync(dirname(path), { recursive: true, force: true });
  mkdirSync(dirname(path), { recursive: true });
  const wal = `${source}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0)
    throw new Error(`${wal} holds writes: quit Zotero to copy ${source}`);
  const from = new DatabaseSync(`file:${source}?mode=ro&immutable=1`, {
    readOnly: true,
  });
  from.exec(`vacuum into '${path.replaceAll("'", "''")}'`);
  from.close();
  seedBenchTags(path);
  const keys = topLevelKeys(path);
  return { name: `real ${(keys.length / 1000).toFixed(1)}k`, path, keys };
}

const TOP_LEVEL = `
  select i.itemID, i.key from items i
  join itemTypesCombined t using (itemTypeID)
  where i.libraryID = 1
    and t.typeName not in ('attachment', 'note', 'annotation')
    and i.itemID not in (select itemID from deletedItems)
  order by i.itemID`;

function topLevelKeys(path: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare(TOP_LEVEL).all() as { key: string }[];
  db.close();
  return rows.map(({ key }) => key);
}

function seedBenchTags(path: string): void {
  const db = new DatabaseSync(path);
  const items = db.prepare(TOP_LEVEL).all() as { itemID: number }[];
  const tag = (name: string) => {
    db.prepare("insert into tags (name) values (?)").run(name);
    return Number(
      (
        db.prepare("select tagID from tags where name = ?").get(name) as {
          tagID: number;
        }
      ).tagID,
    );
  };
  db.exec("begin");
  const p01 = tag("bench-p01");
  const p50 = tag("bench-p50");
  const insert = db.prepare(
    "insert into itemTags (itemID, tagID, type) values (?, ?, 0)",
  );
  items.forEach(({ itemID }, index) => {
    if (index % 100 === 0) insert.run(itemID, p01);
    if (index % 2 === 0) insert.run(itemID, p50);
  });
  db.exec("commit");
  db.close();
}

interface Note {
  status: string;
  rating?: number;
}

function unit(i: number, salt: number): number {
  let x = Math.imul(i ^ salt, 0x9e3779b1);
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 2 ** 32;
}

function noteIndex(
  keys: readonly string[],
  coverage: number,
  selectivity: number,
): Map<string, Note> {
  const notes = new Map<string, Note>();
  keys.forEach((key, i) => {
    if (unit(i, 1) >= coverage) return;
    const status =
      unit(i, 2) < selectivity
        ? "read"
        : unit(i, 3) < 0.5
          ? "reading"
          : "unread";
    const rating = unit(i, 4) < 0.8 ? 1 + Math.floor(unit(i, 5) * 5) : null;
    notes.set(key, rating === null ? { status } : { status, rating });
  });
  return notes;
}

function readNote(notes: Map<string, Note>) {
  return (key: string, name: string): VaultValue => {
    const note = notes.get(key);
    if (!note) return { note: false };
    return { note: true, value: note[name as keyof Note] ?? null };
  };
}

function queryFile(zotero: string, scenario: ScenarioName): QueryFile {
  const { vault, sort } = SCENARIOS[scenario];
  const filters = [zotero, ...(vault ? [vault] : [])];
  return parseQueryFile(`views:
  - type: table
    name: bench
    from: items
    filters:
      and:
${filters.map((text) => `        - ${JSON.stringify(text)}`).join("\n")}
    sort:
${sort.map(([property, direction]) => `      - property: ${property}\n        direction: ${direction}`).join("\n")}
    limit: ${LIMIT}
    order:
      - title
      - creators
      - date
      - vault.status
      - vault.rating
`);
}

type Stage = "prelude" | "sources" | "candidate" | "match" | "project" | "tail";

const SOURCES = new Set<ItemQueryReader>([
  "layout",
  "libraries",
  "field-vocabulary",
  "collection-paths",
  "tag-values",
]);
const CANDIDATES = new Set<ItemQueryReader>([
  "library-row-count",
  "candidate-set",
  "relation-candidate-set",
]);
const PAGES = new Set<ItemQueryReader>(["scan-page", "universe-rows"]);

interface Measure {
  plan: number;
  parse: number;
  engine: number;
  stages: Record<Stage, number>;
  paused: number;
  transfer: number;
  client: number;
  total: number;
}

interface Facts {
  filterBytes: number;
  list: "none" | "include" | "exclude";
  listSize: number;
  cap: number | null;
  keyCandidates: number | null;
  path: "candidates" | "scan";
  fellBack: boolean;
  evaluated: number;
  returned: number;
  matched: number;
  shown: number;
  truncated: boolean;
  statements: Partial<Record<ItemQueryReader, number>>;
  keys: string[];
}

async function runOnce(
  client: NodeDatabaseClient,
  file: QueryFile,
  notes: Map<string, Note>,
): Promise<{ measure: Measure; facts: Facts }> {
  const view = file.views[0]!;
  const read = readNote(notes);
  const planner = new ViewPlanner({
    context: () => undefined,
    host: () => null,
    notes: { itemKeys: () => notes.keys(), read },
  });
  const t0 = performance.now();
  const planned = planner.plan(file, view);
  const t1 = performance.now();
  if (planned.fault)
    throw new Error(`vault filter fault: ${planned.fault.diagnostic.code}`);
  if (planned.request.filter !== undefined) {
    const parsed = planItemFilter(planned.request.filter);
    if ("code" in parsed) throw new Error(`filter: ${parsed.message}`);
  }
  const t2 = performance.now();

  const events: { reader: ItemQueryReader; ms: number }[] = [];
  const statements: Partial<Record<ItemQueryReader, number>> = {};
  let paused = 0;
  let pausedAt: number | null = null;
  let pausedSince = 0;
  let last: number | null = null;
  let cap: number | null = null;
  let keyCandidates: number | null = null;
  let evaluated = 0;
  const observe = (run: StatementRun) => {
    const now = performance.now();
    events.push({
      reader: run.reader,
      ms: now - (last ?? engineStart) - pausedSince,
    });
    pausedSince = 0;
    last = now;
    statements[run.reader] = (statements[run.reader] ?? 0) + 1;
    if (run.reader === "library-row-count") {
      const [row] = run.rows as { rows: number }[];
      cap = Math.floor(row!.rows * 0.25);
    }
    if (
      run.reader === "candidate-set" &&
      Object.values(run.params).some(
        (value) => typeof value === "string" && value.startsWith("["),
      )
    )
      keyCandidates = run.rows.length;
    if (PAGES.has(run.reader)) evaluated += run.rows.length;
  };
  const engineStart = performance.now();
  const reply = await Effect.runPromise(
    answerView(
      {
        command: QUERY_COMMAND,
        schema: false,
        view: planned.request,
        scope: MY_LIBRARY_SCOPE,
      },
      {},
    ).pipe(
      Effect.provideService(ItemQueryStatementObserver, observe),
      Effect.provideService(ItemQuerySliceObserver, {
        paused: (at: number) => {
          pausedAt = at;
        },
        resumed: (at: number) => {
          if (pausedAt === null) return;
          paused += at - pausedAt;
          pausedSince += at - pausedAt;
          pausedAt = null;
        },
      }),
      Effect.provideService(ItemQueryDatabase, { client }),
      Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
    ),
  );
  const t3 = performance.now();
  const stages: Record<Stage, number> = {
    prelude: 0,
    sources: 0,
    candidate: 0,
    match: 0,
    project: 0,
    tail: t3 - (last ?? engineStart) - pausedSince,
  };
  const lastPage = events.findLastIndex(({ reader }) => PAGES.has(reader));
  const firstPage = events.findIndex(({ reader }) => PAGES.has(reader));
  events.forEach(({ reader, ms }, index) => {
    const stage: Stage =
      index === 0
        ? "prelude"
        : firstPage !== -1 && index >= firstPage && index <= lastPage
          ? "match"
          : index > lastPage && lastPage !== -1
            ? "project"
            : SOURCES.has(reader)
              ? "sources"
              : CANDIDATES.has(reader)
                ? "candidate"
                : "project";
    stages[stage] += ms;
  });
  const outcome = structuredClone(reply.view);
  const t4 = performance.now();
  if (outcome.kind !== "result")
    throw new Error(`query ${outcome.kind}: ${JSON.stringify(outcome)}`);
  const result = outcome.result as QueryViewResult & { rows: QueryViewRow[] };
  const shown = planned.layout(result.rows);
  const t5 = performance.now();

  const keys = planned.keys;
  return {
    measure: {
      plan: t1 - t0,
      parse: t2 - t1,
      engine: t3 - engineStart,
      stages,
      paused,
      transfer: t4 - t3,
      client: t5 - t4,
      total: t1 - t0 + (t5 - engineStart),
    },
    facts: {
      filterBytes: Buffer.byteLength(planned.request.filter ?? ""),
      list:
        keys === null ? "none" : keys.startsWith("!") ? "exclude" : "include",
      listSize: keys === null ? 0 : (keys.match(/"[^"]*"/g)?.length ?? 0),
      cap,
      keyCandidates,
      path: statements["scan-page"] ? "scan" : "candidates",
      fellBack:
        keys !== null &&
        !keys.startsWith("!") &&
        (keyCandidates === null || (cap !== null && keyCandidates > cap)),
      evaluated,
      returned: result.rows.length,
      matched: result.matchedCount,
      shown: shown.rows.length,
      truncated: result.truncated || shown.dropped,
      statements,
      keys: shown.rows.map((row) => row.annotationKey),
    },
  };
}

interface Cell {
  library: string;
  items: number;
  flavor: Flavor;
  selectivity: number;
  coverage: number;
  scenario: ScenarioName;
  runs: number;
  median: Measure;
  facts: Omit<Facts, "keys">;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function medianOf(measures: Measure[]): Measure {
  const pick = (get: (m: Measure) => number) => median(measures.map(get));
  return {
    plan: pick((m) => m.plan),
    parse: pick((m) => m.parse),
    engine: pick((m) => m.engine),
    stages: Object.fromEntries(
      Object.keys(measures[0]!.stages).map((stage) => [
        stage,
        pick((m) => m.stages[stage as Stage]),
      ]),
    ) as Record<Stage, number>,
    paused: pick((m) => m.paused),
    transfer: pick((m) => m.transfer),
    client: pick((m) => m.client),
    total: pick((m) => m.total),
  };
}

async function zoteroMatches(
  client: NodeDatabaseClient,
  filter: string,
): Promise<string[]> {
  const reply = await Effect.runPromise(
    answerView(
      {
        command: QUERY_COMMAND,
        schema: false,
        view: {
          from: "items",
          filter,
          sort: [{ field: "title", direction: "asc" }],
          fields: [],
          limit: null,
        },
        scope: MY_LIBRARY_SCOPE,
      },
      {},
    ).pipe(
      Effect.provideService(ItemQueryDatabase, { client }),
      Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
    ),
  );
  if (reply.view.kind !== "result") throw new Error("baseline failed");
  return reply.view.result.rows!.map((row) => row.indexedKey);
}

function expected(
  scenario: ScenarioName,
  matches: readonly string[],
  notes: Map<string, Note>,
): string[] | null {
  const passes =
    scenario === "1 vault include"
      ? (key: string) => notes.get(key)?.status === "read"
      : scenario === "2 vault exclude"
        ? (key: string) => notes.get(key)?.status !== "read"
        : scenario === "0 zotero only"
          ? () => true
          : null;
  return passes && matches.filter(passes).slice(0, LIMIT);
}

async function measureLibrary(library: Library, cells: Cell[]): Promise<void> {
  const client = createClient(library.path);
  for (const flavor of Object.keys(ZOTERO_FILTERS) as Flavor[]) {
    for (const selectivity of SELECTIVITIES) {
      const zotero = ZOTERO_FILTERS[flavor][selectivity];
      const matches = await zoteroMatches(client, zotero);
      for (const coverage of COVERAGES) {
        const notes = noteIndex(library.keys, coverage, selectivity);
        for (const scenario of Object.keys(SCENARIOS) as ScenarioName[]) {
          if (scenario === "0 zotero only" && coverage !== COVERAGES[0])
            continue;
          const file = queryFile(zotero, scenario);
          const warm = await runOnce(client, file, notes);
          const want = expected(scenario, matches, notes);
          expect({
            shown: warm.facts.shown,
            keys: want && warm.facts.keys,
          }).toEqual({
            shown: want?.length ?? Math.min(LIMIT, warm.facts.returned),
            keys: want,
          });
          const runs =
            warm.measure.total > 10_000
              ? 1
              : warm.measure.total > 3_000
                ? Math.min(RUNS, 3)
                : RUNS;
          const measures: Measure[] = [];
          for (let i = 0; i < runs; i++)
            measures.push((await runOnce(client, file, notes)).measure);
          const { keys: _keys, ...facts } = warm.facts;
          const cell: Cell = {
            library: library.name,
            items: library.keys.length,
            flavor,
            selectivity,
            coverage,
            scenario,
            runs,
            median: medianOf(measures),
            facts,
          };
          cells.push(cell);
          const m = cell.median;
          // oxlint-disable-next-line effecttsgo/global-console -- a benchmark reports as it goes
          console.info(
            [
              library.name,
              flavor,
              `sel ${selectivity * 100}%`,
              `notes ${coverage * 100}%`,
              scenario,
              `total ${m.total.toFixed(1)}`,
              `plan ${m.plan.toFixed(1)}`,
              `engine ${m.engine.toFixed(1)}`,
              `match ${m.stages.match.toFixed(1)}`,
              `project ${m.stages.project.toFixed(1)}`,
              `client ${m.client.toFixed(1)}`,
              `${facts.list} ${facts.listSize} (${(facts.filterBytes / 1024).toFixed(0)} KB)`,
              `${facts.path}${facts.fellBack ? " fell back" : ""}`,
              `evaluated ${facts.evaluated}, returned ${facts.returned}`,
            ].join(" | "),
          );
        }
      }
    }
  }
  client.$client.close();
}

describe("mixed Query View queries", () => {
  const cells: Cell[] = [];

  it.each(SIZES)("Stress Build of %i Items", async (count) => {
    await measureLibrary(stressLibrary(count), cells);
  });

  it.runIf(REAL !== undefined)("a real Zotero database", async () => {
    await measureLibrary(realLibrary(REAL!), cells);
  });

  it("writes the results", () => {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          at: toInstant(DateTime.nowUnsafe()).toString(),
          node: process.version,
          cells,
        },
        null,
        2,
      ),
    );
    // oxlint-disable-next-line effecttsgo/global-console -- where the results went
    console.info(`results: ${OUT}`);
    expect(cells.length).toBeGreaterThan(0);
  });
});
