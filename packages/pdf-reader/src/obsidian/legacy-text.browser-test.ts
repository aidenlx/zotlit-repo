import type { PdfEngine, PdfReader } from "#/core/index.ts";
import type { LegacyPdfJs } from "#/obsidian/legacy-text.ts";
import type { FixturePdf } from "#test/fixtures.ts";
import type { TestHost } from "#test/host.ts";
import libSource from "@obsidian-pdfjs/pdf.min.mjs?raw";
import workerSource from "@obsidian-pdfjs/pdf.worker.min.mjs?raw";
import { regex } from "arkregex";

import { legacyText } from "#/obsidian/legacy-text.ts";
import { inlineBytes } from "#test/data.ts";
import { fixturePdf } from "#test/fixtures.ts";
import { testHost } from "#test/host.ts";
import {
  fixtureSource,
  forkItems,
  importSource,
  installStyles,
  mountFixture,
  stateWhere,
  testEngine,
  within,
} from "#test/reader.ts";

type Range = readonly [number, number, number, number];

const cmaps = import.meta.glob<string>("@obsidian-pdfjs/cmaps/*.bcmap", {
  eager: true,
  query: "?inline",
  import: "default",
});
const fonts = import.meta.glob<string>(
  "@obsidian-pdfjs/standard_fonts/*.{pfb,ttf}",
  { eager: true, query: "?inline", import: "default" },
);

const SPACES = regex("\\s", "g");
const SELECTION = regex("#page=\\d+&selection=(?<range>[\\d,]+)\\|");

function fileOf(files: Readonly<Record<string, string>>, name: string) {
  const file = Object.entries(files).find(([path]) =>
    path.endsWith(`/${name}`),
  );
  if (!file) throw new Error(`Obsidian has no PDF.js file ${name}`);
  return inlineBytes(file[1]);
}

class ObsidianCMaps {
  async fetch({ name }: { readonly name: string }) {
    return { cMapData: fileOf(cmaps, `${name}.bcmap`), isCompressed: true };
  }
}

class ObsidianFonts {
  async fetch({ filename }: { readonly filename: string }) {
    return fileOf(fonts, filename);
  }
}

const FACTORIES = {
  CMapReaderFactory: ObsidianCMaps,
  StandardFontDataFactory: ObsidianFonts,
};

interface ObsidianPdfJs extends LegacyPdfJs {
  readonly version: string;
  readonly GlobalWorkerOptions: { workerSrc: string };
}

let library: Promise<ObsidianPdfJs> | null = null;

function obsidianPdfJs(): Promise<ObsidianPdfJs> {
  library ??= (async () => {
    const loaded = await importSource<ObsidianPdfJs>(libSource);
    loaded.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
      new Blob([workerSource], { type: "text/javascript" }),
    );
    return loaded;
  })();
  return library;
}

interface Opens {
  opened: number;
  destroyed: number;
  readonly passwords: (string | null)[];
}

function opens(): Opens {
  return { opened: 0, destroyed: 0, passwords: [] };
}

function recorded(record: Opens): () => Promise<LegacyPdfJs> {
  return async () => {
    const pdfjs = await obsidianPdfJs();
    return {
      getDocument: (parameters) => {
        record.opened++;
        record.passwords.push(
          typeof parameters.password === "string" ? parameters.password : null,
        );
        const task = pdfjs.getDocument({ ...parameters, ...FACTORIES });
        return {
          promise: task.promise,
          destroy: () => {
            record.destroyed++;
            return task.destroy();
          },
        };
      },
    };
  };
}

function legacyHost(record: Opens, name: string): TestHost {
  const host = testHost(name);
  host.legacyText = (request) => legacyText(recorded(record), request);
  return host;
}

async function obsidianItems(
  name: FixturePdf,
  pageIndex: number,
): Promise<readonly string[]> {
  using source = legacyText(recorded(opens()), {
    password: undefined,
    bytes: async () => fixturePdf(name),
  });
  const items = await source.items(pageIndex);
  if (!items) throw new Error(`Obsidian's PDF.js read no text of ${name}`);
  return items;
}

function stripped(text: string): string {
  return text.replaceAll(SPACES, "");
}

function slice(items: readonly string[], range: Range): string {
  const [startItem, startOffset, endItem, endOffset] = range;
  let text = "";
  for (let index = startItem; index <= endItem; index++) {
    const item = items[index] ?? "";
    const start = index === startItem ? startOffset : 0;
    const end = index === endItem ? endOffset : item.length;
    text += item.slice(start, end);
  }
  return text;
}

function samples(items: readonly string[], count: number, seed: number) {
  let state = seed;
  const next = () => (state = (state * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32;
  const points: [number, number][] = [];
  items.forEach((item, index) => {
    for (let offset = 0; offset <= item.length; offset++) {
      if (item.length > 0) points.push([index, offset]);
    }
  });
  const ranges: Range[] = [];
  while (ranges.length < count) {
    const first = points[Math.floor(next() * points.length)]!;
    const span = Math.floor(next() * 120) + 1;
    const second =
      points[Math.min(points.length - 1, points.indexOf(first) + span)]!;
    const range: Range = [...first, ...second];
    if (stripped(slice(items, range))) ranges.push(range);
  }
  return ranges;
}

function marked(reader: PdfReader, pageIndex: number): string {
  return [
    ...reader
      .pageAt(pageIndex)!
      .div.querySelectorAll('[data-zpr-highlight="text"]'),
  ]
    .map((mark) => mark.textContent)
    .join("");
}

async function land(reader: PdfReader, subpath: string): Promise<void> {
  await within(`navigate ${subpath}`, reader.navigate(subpath));
  await within(`settled after ${subpath}`, reader.settled());
}

export interface ReadReport {
  readonly obsidianItems: number;
  readonly forkItems: number;
  readonly selections: number;
  readonly matched: number;
  readonly identityWrong: number;
  readonly misses: readonly {
    readonly range: Range;
    readonly expected: string;
    readonly marked: string;
  }[];
}

interface Sampled {
  readonly name: FixturePdf;
  readonly pageIndex: number;
  readonly count: number;
}

async function readDirection(
  engine: PdfEngine,
  { name, pageIndex, count }: Sampled,
): Promise<ReadReport> {
  const record = opens();
  using mounted = mountFixture(engine, {
    source: fixtureSource(name),
    host: legacyHost(record, name),
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  const legacy = await obsidianItems(name, pageIndex);
  const fork = await forkItems(reader, pageIndex);
  let matched = 0;
  let identityWrong = 0;
  const misses: ReadReport["misses"][number][] = [];
  for (const range of samples(legacy, count, pageIndex + 7)) {
    await land(reader, `#page=${pageIndex + 1}&selection=${range.join(",")}`);
    const expected = stripped(slice(legacy, range));
    const shown = stripped(marked(reader, pageIndex));
    if (shown === expected) matched++;
    else misses.push({ range, expected, marked: shown });
    if (stripped(slice(fork, range)) !== expected) identityWrong++;
  }
  return {
    obsidianItems: legacy.length,
    forkItems: fork.length,
    selections: count,
    matched,
    identityWrong,
    misses: misses.slice(0, 3),
  };
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

function textSpans(reader: PdfReader, pageIndex: number): HTMLElement[] {
  return [
    ...(reader
      .pageAt(pageIndex)
      ?.textLayer?.querySelectorAll<HTMLElement>("span:not(.markedContent)") ??
      []),
  ].filter((span) => span.dataset.zprHighlight === undefined);
}

interface Opened {
  readonly host: TestHost;
  readonly reader: PdfReader;
  readonly fork: readonly string[];
  readonly pageIndex: number;
}

async function menuOn(
  { host, reader, fork, pageIndex }: Opened,
  range: Range,
): Promise<{ readonly selected: string; readonly items: readonly string[] }> {
  const spans = textSpans(reader, pageIndex);
  const shown = fork.flatMap((item, index) => (item ? [index] : []));
  if (spans.length !== shown.length) {
    throw new Error(`${spans.length} text spans for ${shown.length} items`);
  }
  const spanOf = (index: number) => spans[shown.indexOf(index)]!;
  const start = spanOf(range[0]);
  const domRange = document.createRange();
  domRange.setStart(start.firstChild!, range[1]);
  domRange.setEnd(spanOf(range[2]).firstChild!, range[3]);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(domRange);
  const selected = selection.toString();
  const before = host.menus.length;
  const box = start.getBoundingClientRect();
  start.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 1,
      clientY: box.top + box.height / 2,
      button: 2,
    }),
  );
  await until("the text menu", () => host.menus.length > before);
  selection.removeAllRanges();
  const menu = host.menus.at(-1)!;
  for (const item of menu) {
    if (item.id === "copy-selection-link" || item.id === "copy-as-quote") {
      item.run();
    }
  }
  await frame();
  return {
    selected,
    items: menu.map((item) => item.id),
  };
}

export interface WriteReport {
  readonly selections: number;
  readonly sameText: number;
  readonly differentIndexes: number;
  readonly quotesWithLink: number;
  readonly relanded: number;
}

async function writeDirection(
  engine: PdfEngine,
  { name, pageIndex, count }: Sampled,
): Promise<WriteReport> {
  const record = opens();
  const host = legacyHost(record, name);
  using mounted = mountFixture(engine, { source: fixtureSource(name), host });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await reader.navigate({ pageIndex });
  await within("rendered", reader.whenRendered(pageIndex));
  await within("settled", reader.settled());
  const legacy = await obsidianItems(name, pageIndex);
  const fork = await forkItems(reader, pageIndex);
  let sameText = 0;
  let differentIndexes = 0;
  let quotesWithLink = 0;
  let relanded = 0;
  for (const range of samples(fork, count, pageIndex + 13)) {
    const copied = host.copied.length;
    const { selected } = await menuOn({ host, reader, fork, pageIndex }, range);
    const [quote = "", link = ""] = host.copied.slice(copied);
    const written = SELECTION.exec(link)?.groups.range;
    if (!written) continue;
    const indexes = written.split(",").map(Number) as unknown as Range;
    if (stripped(slice(legacy, indexes)) === stripped(selected)) sameText++;
    if (indexes.join(",") !== range.join(",")) differentIndexes++;
    if (quote.endsWith(link)) quotesWithLink++;
    await land(reader, link.slice(link.indexOf("#"), link.indexOf("|")));
    if (stripped(marked(reader, pageIndex)) === stripped(selected)) relanded++;
    reader.command("escape");
  }
  return {
    selections: count,
    sameText,
    differentIndexes,
    quotesWithLink,
    relanded,
  };
}

interface PageOnly {
  readonly marks: string;
  readonly items: readonly string[];
  readonly copied: readonly string[];
  readonly reports: readonly string[];
}

export interface FallbackReport {
  readonly outOfRange: { readonly marks: string; readonly opened: number };
  readonly otherText: PageOnly;
  readonly unreadable: PageOnly;
  readonly noSource: PageOnly;
}

async function pageOnly(engine: PdfEngine, host: TestHost): Promise<PageOnly> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/mock-form.pdf"),
    host,
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  const fork = await forkItems(reader, 0);
  const [range] = samples(fork, 1, 3);
  await land(reader, `#page=1&selection=${range!.join(",")}`);
  const marks = marked(reader, 0);
  const copied = host.copied.length;
  const { items } = await menuOn({ host, reader, fork, pageIndex: 0 }, range!);
  return {
    marks,
    items,
    copied: host.copied.slice(copied),
    reports: host.reports.map(({ phase }) => phase),
  };
}

async function fallbacks(engine: PdfEngine): Promise<FallbackReport> {
  const name: FixturePdf = "pdf-reader/mock-form.pdf";
  const record = opens();
  let outOfRange: FallbackReport["outOfRange"];
  {
    using mounted = mountFixture(engine, {
      source: fixtureSource(name),
      host: legacyHost(record, name),
    });
    await within("ready", mounted.reader.whenReady());
    await land(mounted.reader, "#page=1&selection=9999,0,9999,4");
    outOfRange = { marks: marked(mounted.reader, 0), opened: record.opened };
  }
  const other = testHost(name);
  other.legacyText = () => ({
    items: async () => ["Text that is not on this page."],
    [Symbol.dispose]: () => {},
  });
  const unreadable = testHost(name);
  unreadable.legacyText = ({ password }) =>
    legacyText(recorded(opens()), {
      password,
      bytes: async () => new TextEncoder().encode("not a PDF"),
    });
  return {
    outOfRange,
    otherText: await pageOnly(engine, other),
    unreadable: await pageOnly(engine, unreadable),
    noSource: await pageOnly(engine, testHost(name)),
  };
}

export interface LifecycleReport {
  readonly passwords: readonly (string | null)[];
  readonly afterReload: { readonly opened: number; readonly destroyed: number };
  readonly afterDispose: {
    readonly opened: number;
    readonly destroyed: number;
  };
  readonly reports: readonly string[];
}

async function lifecycle(engine: PdfEngine): Promise<LifecycleReport> {
  const name: FixturePdf = "pdf-reader/password.pdf";
  const record = opens();
  const source = fixtureSource(name);
  let afterReload: LifecycleReport["afterReload"];
  const host = legacyHost(record, name);
  {
    using mounted = mountFixture(engine, { source, host });
    const { reader } = mounted;
    await within(
      "the password prompt",
      stateWhere(reader, ({ status }) => status === "password"),
    );
    await until(
      "the prompt",
      () => reader.root.querySelector("[data-zpr-part='password']") !== null,
    );
    reader.root.querySelector<HTMLInputElement>(
      "[data-zpr-part='password-input']",
    )!.value = "zotlit";
    reader.root
      .querySelector<HTMLButtonElement>("[data-zpr-part='password-open']")!
      .click();
    await within("ready", reader.whenReady());
    await land(reader, "#page=1&selection=0,0,0,1");
    source.change();
    await within(
      "the reloaded document",
      stateWhere(reader, ({ status }) => status === "ready"),
    );
    await within("ready again", reader.whenReady());
    await land(reader, "#page=1&selection=0,0,0,1");
    afterReload = { opened: record.opened, destroyed: record.destroyed };
  }
  return {
    passwords: record.passwords,
    afterReload,
    afterDispose: { opened: record.opened, destroyed: record.destroyed },
    reports: host.reports.map(({ phase }) => phase),
  };
}

export interface LegacySelectionReport {
  readonly version: string;
  readonly read: Readonly<Record<string, ReadReport>>;
  readonly write: WriteReport;
  readonly fallbacks: FallbackReport;
  readonly lifecycle: LifecycleReport;
}

export async function run(): Promise<LegacySelectionReport> {
  installStyles();
  using engine = testEngine();
  const { version } = await obsidianPdfJs();
  return {
    version,
    read: {
      "mock-form p1": await readDirection(engine, {
        name: "pdf-reader/mock-form.pdf",
        pageIndex: 0,
        count: 25,
      }),
      "sakimas-song p5": await readDirection(engine, {
        name: "sakimas-song/sakimas-song.pdf",
        pageIndex: 4,
        count: 25,
      }),
    },
    write: await writeDirection(engine, {
      name: "pdf-reader/mock-form.pdf",
      pageIndex: 0,
      count: 15,
    }),
    fallbacks: await fallbacks(engine),
    lifecycle: await lifecycle(engine),
  };
}
