import type {
  NavigateOutcome,
  NavigationTarget,
  PageChangeCause,
  PdfEngine,
  PdfReader,
  Subpath,
} from "#/core/index.ts";

import { parseSubpath } from "#/core/index.ts";
import { testHost } from "#test/host.ts";
import {
  fixtureSource,
  forkItems,
  forkText,
  installStyles,
  mountFixture,
  pause,
  testEngine,
  within,
} from "#test/reader.ts";

type ParsedSubpath = Omit<Subpath, "params"> & {
  readonly params: Readonly<Record<string, string>>;
};

export interface SubpathReport {
  readonly parsed: Readonly<Record<string, ParsedSubpath>>;
  readonly mount: {
    readonly context: Readonly<Record<string, string>> | null;
    readonly pageIndex: number;
    readonly zoom: unknown;
    readonly announced: readonly string[];
  };
  readonly table: Readonly<Record<string, Landing>>;
  readonly offsets: {
    readonly top: number;
    readonly xyz: number;
    readonly fitbh: number;
  };
  readonly selection: { readonly marked: string; readonly expected: string };
  readonly noSource: { readonly landing: Landing; readonly marked: string };
  readonly annotation: {
    readonly boxes: number;
    readonly textMarks: number;
    readonly escape: readonly [boolean, boolean, number];
  };
  readonly announced: readonly string[];
  readonly params: Readonly<Record<string, string>> | null;
  readonly queued: {
    readonly outcomes: readonly NavigateOutcome[];
    readonly pageIndex: number;
    readonly causes: readonly PageChangeCause[];
    readonly announced: readonly string[];
  };
  readonly ordered: Readonly<Record<string, Ordered>>;
  readonly superseded: {
    readonly outcomes: readonly NavigateOutcome[];
    readonly landed: Spot;
    readonly later: Spot;
    readonly findOpen: boolean;
  };
}

interface Spot {
  readonly pageIndex: number;
  readonly top: number;
}

interface Ordered {
  readonly outcomes: readonly NavigateOutcome[];
  readonly pageIndex: number;
  readonly lastBeforeReady: number | null;
}

interface Landing {
  readonly outcome: NavigateOutcome;
  readonly pageIndex: number;
  readonly zoom: unknown;
  readonly scale: number;
}

const PARSED = [
  "#page=3",
  "page=3&offset=72,300,0",
  "#page=3&offset=,300",
  "#page=2&selection=1,5,2,10",
  "#page=4&annotation=5R&selection=0,0,1,3",
  "#chapter-three",
  "#zoom=200",
  "#search=fox",
  "#page=2&search=fox&zoom=200",
  "#page=x&height=300&zt-annotation=K&zt-attachment=A",
  "#",
];

function parsed(raw: string): ParsedSubpath {
  const subpath = parseSubpath(raw);
  return { ...subpath, params: Object.fromEntries(subpath.params) };
}

function pageTop(reader: PdfReader, pageIndex: number): number {
  return (
    reader.pageAt(pageIndex)!.div.getBoundingClientRect().top -
    reader.container.getBoundingClientRect().top
  );
}

async function land(
  reader: PdfReader,
  target: string | { dest: string } | { pageIndex: number },
): Promise<Landing> {
  const outcome = await within(
    `navigate ${JSON.stringify(target)}`,
    reader.navigate(target),
  );
  await within(`settled after ${JSON.stringify(target)}`, reader.settled());
  const state = reader.state.get();
  return {
    outcome,
    pageIndex: state.pageIndex,
    zoom: state.zoom,
    scale: state.scale,
  };
}

function marked(reader: PdfReader, pageIndex: number): string {
  return [
    ...reader
      .pageAt(pageIndex)!
      .div.querySelectorAll('[data-zpr-highlight="text"]'),
  ]
    .map((mark) => mark.textContent)
    .join("|");
}

async function navigation(engine: PdfEngine) {
  let context: Readonly<Record<string, string>> | null = null;
  const announced: string[] = [];
  let params: Readonly<Record<string, string>> | null = null;
  const host = testHost();
  host.legacyText = () => forkText(() => reader);
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
    host,
    subpath: "#page=2&zt-annotation=K&zt-attachment=A",
    extensions: [
      {
        id: "anchor",
        attach: ({ reader, subpath }) => {
          context = subpath ? Object.fromEntries(subpath.params) : null;
          reader.on("subpath", ({ subpath: next }) => {
            announced.push(next.raw);
            if (next.params.has("zt-annotation")) {
              params = Object.fromEntries(next.params);
            }
          });
        },
      },
    ],
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  const mount = {
    context,
    pageIndex: reader.state.get().pageIndex,
    zoom: reader.state.get().zoom,
    announced: [...announced],
  };
  const table: Record<string, Landing> = {};
  for (const target of [
    "#page=3",
    "#chapter-three",
    "#nope",
    "#page=99",
    "#zoom=200",
    "#search=fox",
    "#page=6&zt-annotation=Q&zt-attachment=B",
  ]) {
    table[target] = await land(reader, target);
  }
  table["{dest:chapter-six}"] = await land(reader, { dest: "chapter-six" });
  table["{pageIndex:6}"] = await land(reader, { pageIndex: 6 });
  table["{pageIndex:40}"] = await land(reader, { pageIndex: 40 });

  await land(reader, "#page=4&offset=0,792,0");
  const top = pageTop(reader, 3);
  await land(reader, "#page=4&offset=0,300,0");
  const xyz = pageTop(reader, 3);
  await land(reader, "#page=4&offset=,300");
  const fitbh = pageTop(reader, 3);

  const range: readonly [number, number, number, number] = [2, 5, 4, 10];
  await land(reader, `#page=2&selection=${range.join(",")}`);
  const strings = await forkItems(reader, 1);
  const segments: string[] = [];
  for (let index = range[0]; index <= range[2]; index++) {
    const text = strings[index] ?? "";
    const start = index === range[0] ? range[1] : 0;
    const end = index === range[2] ? range[3] : text.length;
    if (start < end) segments.push(text.slice(start, end));
  }
  const selection = {
    marked: marked(reader, 1),
    expected: segments.join("|"),
  };

  await land(reader, "#page=4&annotation=5R&selection=0,0,1,3");
  const page = reader.pageAt(3)!;
  const boxes = page.div.querySelectorAll(
    '[data-zpr-highlight="annotation"]',
  ).length;
  const textMarks = marked(reader, 3).length;
  const escaped = reader.command("escape");
  const again = reader.command("escape");
  const annotation = {
    boxes,
    textMarks,
    escape: [
      escaped,
      again,
      page.div.querySelectorAll('[data-zpr-highlight="annotation"]').length,
    ] as const,
  };
  return {
    mount,
    table,
    offsets: { top, xyz, fitbh },
    selection,
    annotation,
    announced,
    params,
  };
}

async function noSource(engine: PdfEngine): Promise<SubpathReport["noSource"]> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  return {
    landing: await land(reader, "#page=2&selection=2,5,4,10"),
    marked: marked(reader, 1),
  };
}

async function queued(engine: PdfEngine): Promise<SubpathReport["queued"]> {
  const gate = Promise.withResolvers<void>();
  const announced: string[] = [];
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf", { gate: gate.promise }),
    subpath: "#page=7",
  });
  const { reader } = mounted;
  const causes: PageChangeCause[] = [];
  reader.on("page-change", ({ cause }) => {
    causes.push(cause);
  });
  reader.on("subpath", ({ subpath }) => {
    announced.push(subpath.raw);
  });
  const first = reader.navigate("#page=2");
  const second = reader.navigate("#page=5");
  gate.resolve();
  const outcomes = await within(
    "queued navigates",
    Promise.all([first, second]),
  );
  await within("settled", reader.settled());
  return {
    outcomes,
    pageIndex: reader.state.get().pageIndex,
    causes,
    announced,
  };
}

async function ordered(
  engine: PdfEngine,
  options: {
    readonly subpath?: string;
    readonly early?: NavigationTarget;
    readonly late: NavigationTarget;
    readonly afterReady?: NavigationTarget;
  },
): Promise<Ordered> {
  const gate = Promise.withResolvers<void>();
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf", { gate: gate.promise }),
    ...(options.subpath ? { subpath: options.subpath } : {}),
  });
  const { reader } = mounted;
  const order: (number | "ready")[] = [];
  reader.on("page-change", ({ pageIndex }) => {
    order.push(pageIndex);
  });
  reader.on("ready", () => {
    order.push("ready");
  });
  const outcomes: Promise<NavigateOutcome>[] = [];
  if (options.early) outcomes.push(reader.navigate(options.early));
  if (options.afterReady) {
    gate.resolve();
    await within("ordered ready", reader.whenReady());
    await within("ordered settled", reader.settled());
    outcomes.push(reader.navigate(options.afterReady));
    outcomes.push(reader.navigate(options.late));
  } else {
    const late = Promise.withResolvers<NavigateOutcome>();
    reader.on("document", ({ document }) => {
      if (document) {
        queueMicrotask(() => late.resolve(reader.navigate(options.late)));
      }
    });
    outcomes.push(late.promise);
    gate.resolve();
  }
  const answers = await within("ordered navigates", Promise.all(outcomes));
  await within("ordered settled", reader.settled());
  await pause(300);
  const ready = order.indexOf("ready");
  const before = order.slice(0, ready < 0 ? order.length : ready);
  return {
    outcomes: answers,
    pageIndex: reader.state.get().pageIndex,
    lastBeforeReady: (before.at(-1) as number | undefined) ?? null,
  };
}

async function superseded(
  engine: PdfEngine,
): Promise<SubpathReport["superseded"]> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  const search = reader.navigate("#search=fox");
  const page = reader.navigate("#page=4&offset=0,792,0");
  const outcomes = await within(
    "search then page",
    Promise.all([search, page]),
  );
  await within("settled", reader.settled());
  const spot = (): Spot => ({
    pageIndex: reader.state.get().pageIndex,
    top: pageTop(reader, 3),
  });
  const landed = spot();
  await pause(600);
  return {
    outcomes,
    landed,
    later: spot(),
    findOpen: reader.state.get().find.open,
  };
}

export async function run(): Promise<SubpathReport> {
  installStyles();
  using engine = testEngine();
  return {
    parsed: Object.fromEntries(PARSED.map((raw) => [raw, parsed(raw)])),
    ...(await navigation(engine)),
    noSource: await noSource(engine),
    queued: await queued(engine),
    ordered: {
      mountDest: await ordered(engine, {
        subpath: "#chapter-three",
        late: { pageIndex: 7 },
      }),
      queuedDest: await ordered(engine, {
        early: { dest: "chapter-three" },
        late: { pageIndex: 7 },
      }),
      afterReady: await ordered(engine, {
        afterReady: { dest: "chapter-six" },
        late: { pageIndex: 1 },
      }),
    },
    superseded: await superseded(engine),
  };
}
