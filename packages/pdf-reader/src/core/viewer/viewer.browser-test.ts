import type { PageChangeCause, PdfEngine, ReaderPage } from "#/core/index.ts";

import { mountReader } from "#/core/index.ts";
import { testHost } from "#test/host.ts";
import { bytesSource, pagesPdf } from "#test/pdf.ts";
import {
  addStyle,
  fixtureSource,
  installStyles,
  mountFixture,
  nextEvent,
  pause,
  stateWhere,
  testEngine,
  within,
} from "#test/reader.ts";

export interface ViewerReport {
  readonly textLayer: {
    readonly pages: number;
    readonly textLayers: number;
    readonly text: string;
    readonly expected: string;
  };
  readonly layers: {
    readonly draws: number;
    readonly renders: number;
    readonly sameAbove: boolean;
    readonly sameBelow: boolean;
    readonly aboveAfterText: boolean;
    readonly belowBeforeText: boolean;
    readonly belowAfterCanvas: boolean;
    readonly marker: boolean;
    readonly scale: number;
  };
  readonly rotated: readonly {
    readonly settled: number;
    readonly zoomed: number;
  }[];
  readonly rendered: {
    readonly events: number;
    readonly allJoined: boolean;
    readonly renderedPages: readonly number[];
    readonly early: readonly [string, string];
    readonly failed: readonly [string, string];
  };
  readonly causes: {
    readonly first: readonly Change[];
    readonly reopened: readonly Change[];
    readonly reopenedAt: number;
    readonly position: unknown;
    readonly navigated: readonly Change[];
    readonly scrolled: readonly Change[];
    readonly named: readonly Change[];
  };
  readonly reload: {
    readonly events: readonly string[];
    readonly oldCurrent: boolean;
    readonly newCurrent: boolean;
    readonly pendingRender: string;
    readonly disposed: number;
    readonly attached: number;
    readonly pageIndex: readonly [number, number];
    readonly scale: readonly [number, number];
    readonly reads: number;
    readonly slotKept: boolean;
    readonly migrated: readonly string[];
    readonly migratedPage: number;
  };
  readonly deferred: {
    readonly readsHidden: number;
    readonly statusHidden: string;
    readonly readsShown: number;
    readonly ready: boolean;
  };
  readonly redraw: {
    readonly scrollTop: readonly [number, number, number];
    readonly changes: number;
    readonly repainted: readonly number[];
    readonly settled: boolean;
  };
  readonly popout: {
    readonly ready: boolean;
    readonly frameFonts: number;
    readonly mainFonts: number;
    readonly movedPage: number;
    readonly movedTo: boolean;
  };
}

interface Change {
  readonly pageIndex: number;
  readonly previous: number;
  readonly cause: PageChangeCause;
}

async function textLayer(
  engine: PdfEngine,
): Promise<ViewerReport["textLayer"]> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/mock-form.pdf"),
  });
  const { reader } = mounted;
  const document = await within("mock-form ready", reader.whenReady());
  const page = await within("mock-form page 1", reader.whenRendered(0));
  const proxy = await document!.page(0);
  const content = await proxy!.getTextContent({
    includeChars: true,
    disableNormalization: true,
  });
  return {
    pages: reader.container.querySelectorAll('.page[data-page-number="1"]')
      .length,
    textLayers: page!.div.querySelectorAll(".textLayer").length,
    text: page!.textLayer?.textContent ?? "",
    expected: content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(""),
  };
}

async function layers(engine: PdfEngine): Promise<ViewerReport["layers"]> {
  let draws = 0;
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
    extensions: [
      {
        id: "probe",
        drawPage: (page, layer) => {
          draws++;
          const marker = layer.ownerDocument.createElement("span");
          marker.dataset.probe = String(page.pageIndex);
          layer.replaceChildren(marker);
        },
      },
    ],
  });
  const { reader } = mounted;
  let renders = 0;
  reader.on("page-rendered", () => {
    renders++;
  });
  await within("navigation ready", reader.whenReady());
  const page = (await within("page 1", reader.whenRendered(0)))!;
  await within("settled", reader.settled());
  const above = page.layer("probe");
  const below = page.layer("under", { order: "below-text" });
  reader.set({ zoom: 2 });
  await within("page 1 after zoom", reader.whenRendered(0));
  await within("settled after zoom", reader.settled());
  const text = page.textLayer!;
  const canvas = page.div.querySelector(":scope > .canvasWrapper")!;
  const follows = (first: Node, second: Node) =>
    (first.compareDocumentPosition(second) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0;
  return {
    draws,
    renders,
    sameAbove: page.layer("probe") === above && above.parentNode === page.div,
    sameBelow:
      page.layer("under", { order: "below-text" }) === below &&
      below.parentNode === page.div,
    aboveAfterText: follows(text, above),
    belowBeforeText: follows(below, text),
    belowAfterCanvas: follows(canvas, below),
    marker: above.querySelector('[data-probe="0"]') !== null,
    scale: reader.state.get().scale,
  };
}

async function rotated(engine: PdfEngine): Promise<ViewerReport["rotated"]> {
  const trials: ViewerReport["rotated"][number][] = [];
  for (let trial = 0; trial < 10; trial++) {
    using mounted = mountFixture(engine, {
      source: fixtureSource("excerpt-rendering/excerpt-rendering.pdf"),
      subpath: "#page=2",
    });
    const { reader } = mounted;
    await within("rotated ready", reader.whenReady());
    await within("rotated settled", reader.settled());
    const settled = reader.state.get().pageIndex;
    reader.set({ zoom: 2 });
    await within(
      "rotated zoom",
      stateWhere(reader, ({ scale }) => scale === 2),
    );
    await within("rotated settled after zoom", reader.settled());
    trials.push({ settled, zoomed: reader.state.get().pageIndex });
  }
  return trials;
}

async function rendered(engine: PdfEngine): Promise<ViewerReport["rendered"]> {
  const gate = Promise.withResolvers<void>();
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf", { gate: gate.promise }),
  });
  const { reader } = mounted;
  const answer = (page: Promise<unknown>) =>
    Promise.race([
      page.then((value) => (value === null ? "null" : "page")),
      pause(2000).then(() => "pending"),
    ]);
  const pastEnd = reader.whenRendered(99);
  const first = reader.whenRendered(0);
  gate.resolve();
  const joined: boolean[] = [];
  reader.on("page-rendered", ({ page }) => {
    joined.push(page.rendered && (page.textLayer?.childElementCount ?? 0) > 0);
  });
  await within("navigation ready", reader.whenReady());
  await within("settled", reader.settled());
  reader.set({ zoom: 1.5 });
  await within("settled after zoom", reader.settled());
  const corruptGate = Promise.withResolvers<void>();
  using corrupt = mountFixture(engine, {
    source: fixtureSource("excerpt-rendering/corrupt.pdf", {
      gate: corruptGate.promise,
    }),
  });
  const whileLoading = answer(corrupt.reader.whenRendered(0));
  corruptGate.resolve();
  await within(
    "the corrupt file fails",
    stateWhere(corrupt.reader, ({ status }) => status === "failed"),
  );
  const afterFailure = answer(corrupt.reader.whenRendered(0));
  return {
    events: joined.length,
    allJoined: joined.every(Boolean),
    renderedPages: reader.renderedPages().map((page) => page.pageIndex),
    early: [await answer(first), await answer(pastEnd)],
    failed: [await whileLoading, await afterFailure],
  };
}

function recordChanges(changes: Change[]) {
  return (change: Change) => {
    changes.push({
      pageIndex: change.pageIndex,
      previous: change.previous,
      cause: change.cause,
    });
  };
}

async function causes(engine: PdfEngine): Promise<ViewerReport["causes"]> {
  const host = testHost("navigation.pdf");
  const first: Change[] = [];
  {
    using mounted = mountFixture(engine, {
      host,
      source: fixtureSource("pdf-reader/navigation.pdf"),
    });
    const { reader } = mounted;
    reader.on("page-change", recordChanges(first));
    await within("first ready", reader.whenReady());
    await within("first settled", reader.settled());
    const fifth = reader.pageAt(4)!;
    const turned = nextEvent(
      reader,
      "page-change",
      ({ pageIndex }) => pageIndex === 4,
    );
    reader.container.scrollTop = fifth.div.offsetTop - 60;
    await within("scrolled to page 5", turned);
    await within("first settled again", reader.settled());
  }
  const reopened: Change[] = [];
  using mounted = mountFixture(engine, {
    host,
    source: fixtureSource("pdf-reader/navigation.pdf"),
  });
  const { reader } = mounted;
  reader.on("page-change", recordChanges(reopened));
  await within("reopened ready", reader.whenReady());
  await within("reopened settled", reader.settled());
  await pause(400);
  const restored = [...reopened];
  const reopenedAt = reader.state.get().pageIndex;
  const position = reader.position();
  const navigated: Change[] = [];
  const offNavigated = reader.on("page-change", recordChanges(navigated));
  await reader.navigate({ pageIndex: 1 });
  await within("navigated settled", reader.settled());
  await pause(300);
  offNavigated();
  const scrolled: Change[] = [];
  reader.on("page-change", recordChanges(scrolled));
  const away = nextEvent(reader, "page-change");
  reader.container.scrollTop += reader.pageAt(1)!.div.clientHeight * 2;
  await within("scrolled away", away);
  await pause(300);
  return {
    first,
    reopened: restored,
    reopenedAt,
    position,
    navigated,
    scrolled,
    named: await namedAction(engine),
  };
}

async function namedAction(engine: PdfEngine): Promise<readonly Change[]> {
  using mounted = mountFixture(engine, {
    source: bytesSource(
      "named-action.pdf",
      pagesPdf(3, {
        0: "<< /Type /Annot /Subtype /Link /Rect [72 600 300 700] /Border [0 0 0] /A << /S /Named /N /NextPage >> >>",
      }),
    ),
  });
  const { reader } = mounted;
  await within("named ready", reader.whenReady());
  await within("named settled", reader.settled());
  const deadline = performance.now() + 10_000;
  let link: HTMLAnchorElement | null = null;
  while (!link) {
    if (performance.now() > deadline) throw new Error("No named-action link");
    link = reader.pageAt(0)!.div.querySelector(".linkAnnotation a");
    await pause(50);
  }
  const named: Change[] = [];
  reader.on("page-change", recordChanges(named));
  const turned = nextEvent(reader, "page-change");
  link.click();
  await within("named page change", turned);
  return named;
}

async function reload(engine: PdfEngine): Promise<ViewerReport["reload"]> {
  const source = fixtureSource("pdf-reader/navigation.pdf");
  let disposed = 0;
  let attached = 0;
  const events: string[] = [];
  using mounted = mountFixture(engine, {
    source,
    extensions: [
      {
        id: "lifetime",
        attach: ({ reader }) => {
          attached++;
          reader.on("document", ({ document }) => {
            events.push(document === null ? "document:null" : "document");
          });
          reader.on("ready", ({ first }) => {
            events.push(`ready:${first}`);
          });
          return {
            [Symbol.dispose]: () => {
              disposed++;
            },
          };
        },
      },
    ],
  });
  const { reader } = mounted;
  const old = (await within("ready", reader.whenReady()))!;
  await within("settled", reader.settled());
  await reader.navigate({ pageIndex: 2 });
  await within("settled at page 3", reader.settled());
  const before = reader.state.get();
  const slot = reader.slot("toolbar-end");
  const button = slot.ownerDocument.createElement("button");
  slot.append(button);
  const pending = reader.whenRendered(7);
  const ready = nextEvent(reader, "ready");
  source.change();
  const answer = await within("pending render", pending);
  const { document } = await within("reloaded", ready);
  await within("settled after reload", reader.settled());
  const after = reader.state.get();
  const slotKept =
    reader.slot("toolbar-end") === slot &&
    button.parentNode === slot &&
    slot.isConnected;
  const reloaded = [...events];
  const newCurrent = document.current();
  events.length = 0;
  const migratedReady = nextEvent(reader, "ready");
  reader.on("window-migrated", ({ window }) => {
    events.push(window === globalThis.window ? "window-migrated" : "other");
  });
  reader.windowMigrated();
  await within("ready after window migration", migratedReady);
  await within("settled after window migration", reader.settled());
  return {
    events: reloaded,
    oldCurrent: old.current(),
    newCurrent,
    pendingRender: answer === null ? "null" : "page",
    disposed,
    attached,
    pageIndex: [before.pageIndex, after.pageIndex],
    scale: [before.scale, after.scale],
    reads: source.reads,
    slotKept,
    migrated: [...events],
    migratedPage: reader.state.get().pageIndex,
  };
}

async function deferred(engine: PdfEngine): Promise<ViewerReport["deferred"]> {
  const source = fixtureSource("pdf-reader/navigation.pdf");
  using mounted = mountFixture(engine, { source, deferUntilVisible: true });
  const { reader, element } = mounted;
  addStyle(element, "display: none;");
  source.change();
  reader.windowMigrated();
  await pause(300);
  const readsHidden = source.reads;
  const statusHidden = reader.state.get().status;
  element.style.display = "";
  const document = await within("deferred ready", reader.whenReady());
  return {
    readsHidden,
    statusHidden,
    readsShown: source.reads,
    ready: document !== null,
  };
}

async function redraw(engine: PdfEngine): Promise<ViewerReport["redraw"]> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await reader.navigate({ pageIndex: 1, top: 400 });
  await within("settled", reader.settled());
  await pause(300);
  let changes = 0;
  reader.on("page-change", () => {
    changes++;
  });
  const repainted: number[] = [];
  reader.on("page-rendered", ({ page }: { readonly page: ReaderPage }) => {
    repainted.push(page.pageIndex);
  });
  const start = reader.container.scrollTop;
  await within("redraw page 2", reader.redraw(1));
  const afterOne = reader.container.scrollTop;
  await within("redraw all", reader.redraw());
  let settled = false;
  await within("settled after redraw", reader.settled());
  settled = true;
  await pause(300);
  return {
    scrollTop: [start, afterOne, reader.container.scrollTop],
    changes,
    repainted,
    settled,
  };
}

async function popout(engine: PdfEngine): Promise<ViewerReport["popout"]> {
  const frame = document.createElement("iframe");
  addStyle(frame, "width: 800px; height: 600px; border: 0;");
  document.body.append(frame);
  const frameDocument = frame.contentDocument!;
  for (const style of document.head.querySelectorAll("style")) {
    frameDocument.head.append(frameDocument.importNode(style, true));
  }
  const element = frameDocument.createElement("div");
  addStyle(element, "position: relative; width: 760px; height: 540px;");
  frameDocument.body.append(element);
  const reader = mountReader(element, {
    engine,
    host: testHost(),
    hostContext: null,
    kind: "view",
    source: fixtureSource("sandve-2013/sandve-2013.pdf"),
  });
  try {
    const opened = await within("pop-out ready", reader.whenReady());
    await within("pop-out settled", reader.settled());
    const families = new Set(
      [...frameDocument.fonts].map((face) => face.family),
    );
    return {
      ready: opened !== null,
      frameFonts: families.size,
      mainFonts: [...document.fonts].filter((face) => families.has(face.family))
        .length,
      ...(await moved(engine, frameDocument)),
    };
  } finally {
    reader[Symbol.dispose]();
    frame.remove();
  }
}

async function moved(
  engine: PdfEngine,
  frameDocument: Document,
): Promise<{ readonly movedPage: number; readonly movedTo: boolean }> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
  });
  const { reader, element } = mounted;
  await within("ready before move", reader.whenReady());
  await reader.navigate({ pageIndex: 2 });
  await within("settled before move", reader.settled());
  const ready = nextEvent(reader, "ready");
  frameDocument.body.append(element);
  reader.windowMigrated();
  await within("ready after move", ready);
  await within("settled after move", reader.settled());
  return {
    movedPage: reader.state.get().pageIndex,
    movedTo: reader.root.ownerDocument === frameDocument,
  };
}

export async function run(): Promise<ViewerReport> {
  installStyles();
  using engine = testEngine();
  return {
    textLayer: await textLayer(engine),
    layers: await layers(engine),
    rotated: await rotated(engine),
    rendered: await rendered(engine),
    causes: await causes(engine),
    reload: await reload(engine),
    deferred: await deferred(engine),
    redraw: await redraw(engine),
    popout: await popout(engine),
  };
}
