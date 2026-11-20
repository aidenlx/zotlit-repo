import type { FindState, PdfEngine, PdfReader } from "#/core/index.ts";

import { testHost } from "#test/host.ts";
import {
  fixtureSource,
  installStyles,
  mountFixture,
  part,
  stateWhere,
  testEngine,
  typeInto,
  within,
} from "#test/reader.ts";

export interface FindReport {
  readonly opened: {
    readonly visible: boolean;
    readonly focused: boolean;
  };
  readonly phases: readonly FindState["phase"][];
  readonly fox: FindState["result"];
  readonly count: string;
  readonly highlights: number;
  readonly cycle: readonly number[];
  readonly back: number;
  readonly composing: {
    readonly open: boolean;
    readonly next: number;
  };
  readonly whole: FindState["result"];
  readonly caseAndWhole: FindState["result"];
  readonly loose: FindState["result"];
  readonly strict: FindState["result"];
  readonly missing: { readonly phase: string; readonly count: string };
  readonly saved: unknown;
  readonly restored: Pick<
    FindState,
    "caseSensitive" | "entireWord" | "matchDiacritics" | "highlightAll"
  >;
  readonly closed: {
    readonly escape: boolean;
    readonly open: boolean;
    readonly hidden: boolean;
    readonly highlights: number;
    readonly again: boolean;
  };
  readonly capped: FindState["result"];
  readonly cappedCount: string;
  readonly hash: Pick<FindState, "open" | "query" | "highlightAll"> & {
    readonly highlights: number;
    readonly stored: unknown;
    readonly storedAfterToggle: unknown;
  };
  readonly reloaded: {
    readonly phases: readonly FindState["phase"][];
    readonly result: FindState["result"];
    readonly highlights: number;
  };
  readonly spinner: {
    readonly pending: boolean[];
    readonly settled: boolean[];
  };
  readonly settings: {
    readonly opened: string | null;
    readonly afterScroller: boolean;
    readonly afterInput: boolean;
    readonly afterReopen: boolean;
  };
}

function settledFind(reader: PdfReader): Promise<FindState> {
  return within(
    "the find result",
    stateWhere(
      reader,
      ({ find }) =>
        (find.phase === "found" && find.result !== null) ||
        find.phase === "not-found",
    ),
  ).then((state) => state.find);
}

const spinner: FindReport["spinner"] = { pending: [], settled: [] };

function spinning(reader: PdfReader): boolean {
  return getComputedStyle(part(reader, "find-pending")).display !== "none";
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function until(label: string, check: () => boolean): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`${label} timed out`);
    await frame();
  }
}

async function search(reader: PdfReader, query: string): Promise<FindState> {
  typeInto(part<HTMLInputElement>(reader, "find-input"), query);
  await within(
    `the pending search for ${query}`,
    stateWhere(reader, ({ find }) => find.phase === "pending"),
  );
  spinner.pending.push(spinning(reader));
  const settled = await settledFind(reader);
  await frame();
  spinner.settled.push(spinning(reader));
  return settled;
}

async function option(
  reader: PdfReader,
  set: Partial<FindState>,
): Promise<FindState> {
  reader.set({ find: set });
  await within(
    "the option search",
    stateWhere(reader, ({ find }) =>
      Object.entries(set).every(
        ([key, value]) => find[key as keyof FindState] === value,
      ),
    ),
  );
  return settledFind(reader);
}

function highlights(reader: PdfReader): number {
  return reader.container.querySelectorAll(".textLayer .highlight").length;
}

async function chromeFind(
  engine: PdfEngine,
): Promise<
  Omit<
    FindReport,
    "capped" | "cappedCount" | "hash" | "reloaded" | "spinner" | "settings"
  >
> {
  const host = testHost("chrome.pdf");
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/chrome.pdf"),
    host,
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  const phases: FindState["phase"][] = [];
  reader.state.subscribe(({ find }) => {
    if (phases.at(-1) !== find.phase) phases.push(find.phase);
  });
  reader.set({ find: { open: true } });
  await within(
    "the find bar",
    stateWhere(reader, ({ find }) => find.open),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const input = part<HTMLInputElement>(reader, "find-input");
  const opened = {
    visible: getComputedStyle(part(reader, "find-bar")).display !== "none",
    focused: document.activeElement === input,
  };
  const fox = await search(reader, "fox");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const count = part(reader, "find-count").textContent ?? "";
  const highlighted = highlights(reader);
  const cycle: number[] = [];
  for (let step = 0; step < (fox.result?.total ?? 0); step++) {
    reader.command("find-next");
    const state = await within(
      "the next match",
      stateWhere(
        reader,
        ({ find }) =>
          find.phase === "found" &&
          find.result !== null &&
          find.result.current !== (cycle.at(-1) ?? fox.result?.current),
      ),
    );
    cycle.push(state.find.result?.current ?? -1);
  }
  reader.command("find-previous");
  const back = (
    await within(
      "the previous match",
      stateWhere(reader, ({ find }) => find.result?.current !== cycle.at(-1)),
    )
  ).find.result?.current;
  const key = (init: KeyboardEventInit) =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  key({ key: "Enter", isComposing: true });
  key({ key: "Enter", keyCode: 229 });
  key({ key: "Escape", isComposing: true });
  const composingOpen = reader.state.get().find.open;
  key({ key: "Enter" });
  const composingNext = (
    await within(
      "the next match after the composition",
      stateWhere(reader, ({ find }) => find.result?.current !== back),
    )
  ).find.result?.current;
  const whole = (await option(reader, { entireWord: true })).result;
  const caseAndWhole = (await option(reader, { caseSensitive: true })).result;
  await option(reader, { caseSensitive: false, entireWord: false });
  const loose = (await search(reader, "cafe")).result;
  const strict = (await option(reader, { matchDiacritics: true })).result;
  const notFound = await search(reader, "zebra");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const missing = {
    phase: notFound.phase,
    count: part(reader, "find-count").textContent ?? "",
  };
  await option(reader, { caseSensitive: true, highlightAll: false });
  const saved = host.storage.get("find-options");
  const escape = reader.command("escape");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const closed = {
    escape,
    open: reader.state.get().find.open,
    hidden: getComputedStyle(part(reader, "find-bar")).display === "none",
    highlights: highlights(reader),
    again: reader.command("find-next"),
  };
  using again = mountFixture(engine, {
    source: fixtureSource("pdf-reader/chrome.pdf"),
    host,
  });
  const restoredFind = again.reader.state.get().find;
  return {
    opened,
    phases,
    fox: fox.result,
    count,
    highlights: highlighted,
    cycle,
    back: back ?? -1,
    composing: { open: composingOpen, next: composingNext ?? -1 },
    whole,
    caseAndWhole,
    loose,
    strict,
    missing,
    saved,
    restored: {
      caseSensitive: restoredFind.caseSensitive,
      entireWord: restoredFind.entireWord,
      matchDiacritics: restoredFind.matchDiacritics,
      highlightAll: restoredFind.highlightAll,
    },
    closed,
  };
}

async function cappedFind(
  engine: PdfEngine,
): Promise<Pick<FindReport, "capped" | "cappedCount">> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  reader.set({ find: { open: true } });
  typeInto(part<HTMLInputElement>(reader, "find-input"), "e");
  const state = await within(
    "the capped count",
    stateWhere(reader, ({ find }) => find.result?.capped === true),
    30_000,
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return {
    capped: state.find.result,
    cappedCount: part(reader, "find-count").textContent ?? "",
  };
}

async function hashFind(engine: PdfEngine): Promise<FindReport["hash"]> {
  const host = testHost("chrome.pdf");
  host.storage.set("find-options", {
    caseSensitive: false,
    highlightAll: false,
    matchDiacritics: false,
    entireWord: false,
  });
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/chrome.pdf"),
    host,
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await reader.navigate("#search=sampling");
  const { find } = await within(
    "the hash search",
    stateWhere(reader, ({ find }) => find.open && find.phase === "found"),
  );
  reader.command("find-next");
  await within(
    "the second hash match",
    stateWhere(reader, ({ find }) => find.result?.current === 2),
  );
  await within("settled", reader.settled());
  await until("the two hash highlights", () => highlights(reader) >= 2);
  const stored = host.storage.get("find-options");
  reader.set({ find: { caseSensitive: true } });
  return {
    open: find.open,
    query: find.query,
    highlightAll: find.highlightAll,
    highlights: highlights(reader),
    stored,
    storedAfterToggle: host.storage.get("find-options"),
  };
}

async function reloadedFind(
  engine: PdfEngine,
): Promise<FindReport["reloaded"]> {
  const source = fixtureSource("pdf-reader/chrome.pdf");
  using mounted = mountFixture(engine, { source });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  reader.set({ find: { open: true } });
  await search(reader, "fox");
  const phases: FindState["phase"][] = [];
  reader.state.subscribe(({ find }) => {
    if (phases.at(-1) !== find.phase) phases.push(find.phase);
  });
  source.change();
  await within(
    "the search after the reload",
    stateWhere(reader, ({ find }) => find.phase === "pending"),
  );
  const { result } = await settledFind(reader);
  await within("settled", reader.settled());
  await until("the highlights after the reload", () => highlights(reader) > 0);
  return { phases, result, highlights: highlights(reader) };
}

async function settingsPanel(
  engine: PdfEngine,
): Promise<FindReport["settings"]> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/chrome.pdf"),
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  reader.set({ find: { open: true } });
  await frame();
  const options = part<HTMLButtonElement>(reader, "find-options");
  const panel = () =>
    reader.root.querySelector("[data-zpr-part='find-settings']") !== null;
  const press = (target: Element) =>
    target.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  options.click();
  await until("the open options", panel);
  const opened = options.getAttribute("aria-expanded");
  await frame();
  press(reader.container);
  await frame();
  const afterScroller = panel();
  options.click();
  await until("the reopened options", panel);
  await frame();
  press(part(reader, "find-input"));
  await frame();
  const afterInput = panel();
  options.click();
  await until("the options before the close", panel);
  reader.set({ find: { open: false } });
  await frame();
  reader.set({ find: { open: true } });
  await frame();
  return { opened, afterScroller, afterInput, afterReopen: panel() };
}

export async function run(): Promise<FindReport> {
  installStyles();
  using engine = testEngine();
  return {
    ...(await chromeFind(engine)),
    ...(await cappedFind(engine)),
    hash: await hashFind(engine),
    reloaded: await reloadedFind(engine),
    settings: await settingsPanel(engine),
    spinner,
  };
}
