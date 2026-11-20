import type {
  ContextTarget,
  PdfEngine,
  PdfReader,
  ReaderExtension,
} from "#/core/index.ts";
import type { TestHost } from "#test/host.ts";

import { builtInItems } from "#/core/menus/menus.ts";
import { testHost } from "#test/host.ts";
import { bytesSource, pagesPdf } from "#test/pdf.ts";
import {
  fixtureSource,
  forkText,
  installStyles,
  mountFixture,
  stateWhere,
  testEngine,
  within,
} from "#test/reader.ts";

interface Chosen {
  readonly ids: readonly string[];
  readonly titles: readonly string[];
  readonly copied: Readonly<Record<string, string>>;
}

export interface MenusReport {
  readonly text: Chosen;
  readonly textIndex: number;
  readonly relanded: string;
  readonly annotation: Chosen;
  readonly link: Chosen;
  readonly page: Chosen;
  readonly thumbnail: Chosen;
  readonly outline: Chosen;
  readonly methods: Chosen;
  readonly targets: readonly string[];
  readonly popup: {
    readonly contents: string;
    readonly meta: string;
    readonly copied: string;
    readonly escape: boolean;
    readonly gone: boolean;
    readonly stale: boolean;
    readonly optionClosed: boolean;
    readonly inView: boolean;
  };
  readonly lines: string;
  readonly icon: { readonly src: string; readonly alt: string };
  readonly titled: readonly {
    readonly title: string;
    readonly copied: string;
  }[];
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

async function openMenu(
  host: TestHost,
  target: Element,
  point: readonly [number, number],
): Promise<void> {
  const before = host.menus.length;
  target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: point[0],
      clientY: point[1],
      button: 2,
    }),
  );
  await until("the menu", () => host.menus.length > before);
}

async function chooseAll(host: TestHost): Promise<Chosen> {
  const menu = host.menus.at(-1) ?? [];
  const copied: Record<string, string> = {};
  for (const item of menu) {
    const before = host.copied.length;
    item.run();
    await frame();
    if (host.copied.length > before) copied[item.id] = host.copied.at(-1)!;
  }
  return {
    ids: menu.map((item) => item.id),
    titles: menu.map((item) => item.title),
    copied,
  };
}

function center(element: Element): [number, number] {
  const box = element.getBoundingClientRect();
  return [box.left + box.width / 2, box.top + box.height / 2];
}

function pdfPoint(
  reader: PdfReader,
  pageIndex: number,
  point: readonly [number, number],
): [number, number] {
  const page = reader.pageAt(pageIndex)!;
  const [x = 0, y = 0] = page.viewport.convertToViewportPoint(
    point[0],
    point[1],
  ) as number[];
  const box = page.div.getBoundingClientRect();
  return [box.left + page.div.clientLeft + x, box.top + page.div.clientTop + y];
}

function textSpan(reader: PdfReader, pageIndex: number, text: string) {
  const spans = [
    ...(reader.pageAt(pageIndex)?.textLayer?.querySelectorAll("span") ?? []),
  ];
  const span = spans.find((element) => element.textContent === text);
  if (!span) throw new Error(`No text span ${text}`);
  return span;
}

async function showPage(reader: PdfReader, pageIndex: number) {
  await reader.navigate({ pageIndex });
  await within(`page ${pageIndex}`, reader.whenRendered(pageIndex));
  await within("settled", reader.settled());
}

async function chromeMenus(
  engine: PdfEngine,
): Promise<Omit<MenusReport, "icon" | "titled" | "lines">> {
  const targets: ContextTarget[] = [];
  const extension: ReaderExtension<null> = {
    id: "probe",
    contextMenu: (target) => {
      targets.push(target);
      return [{ id: `probe-${target.kind}`, title: "Probe", run: () => {} }];
    },
  };
  const host = testHost("chrome.pdf");
  host.legacyText = () => forkText(() => reader);
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/chrome.pdf"),
    host,
    extensions: [extension],
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());

  const span = textSpan(reader, 0, "The fox and the Fox.");
  const node = span.firstChild!;
  const range = document.createRange();
  range.setStart(node, 4);
  range.setEnd(node, 15);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  await openMenu(host, span, center(span));
  const text = await chooseAll(host);
  const textIndex = [
    ...(reader
      .pageAt(0)
      ?.textLayer?.querySelectorAll("span:not(.markedContent)") ?? []),
  ].indexOf(span);
  selection.removeAllRanges();
  const quote = text.copied["copy-selection-link"] ?? "";
  const subpath = quote.slice(quote.indexOf("#"), quote.indexOf("|"));
  await reader.navigate(subpath);
  await within("settled", reader.settled());
  const relanded = [
    ...reader.container.querySelectorAll("[data-zpr-highlight='text']"),
  ]
    .map((mark) => mark.textContent)
    .join("");
  reader.command("escape");

  const linkPoint = pdfPoint(reader, 0, [100, 604]);
  await openMenu(host, document.elementFromPoint(...linkPoint)!, linkPoint);
  const link = await chooseAll(host);

  const emptyPoint = pdfPoint(reader, 0, [500, 300]);
  await openMenu(host, document.elementFromPoint(...emptyPoint)!, emptyPoint);
  const page = await chooseAll(host);

  await showPage(reader, 1);
  const annotationPoint = pdfPoint(reader, 1, [150, 604]);
  const popupQuery = () =>
    reader.root.querySelector("[data-zpr-part='annotation-popup']");
  const press = (
    target: EventTarget,
    type: string,
    [x, y]: readonly [number, number],
  ) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0,
      }),
    );
  const pressTarget = document.elementFromPoint(...annotationPoint)!;
  press(pressTarget, "pointerdown", annotationPoint);
  press(document.body, "pointerup", [
    annotationPoint[0] + 200,
    annotationPoint[1] + 200,
  ]);
  press(pressTarget, "pointerup", annotationPoint);
  await openMenu(
    host,
    document.elementFromPoint(...annotationPoint)!,
    annotationPoint,
  );
  const stale = popupQuery() !== null;
  const annotation = await chooseAll(host);

  reader.set({ find: { open: true, query: "highlighted" } });
  await within(
    "the find match",
    stateWhere(
      reader,
      ({ find }) => find.phase === "found" && find.result !== null,
    ),
  );
  await within("settled", reader.settled());
  const scrollerBox = reader.container.getBoundingClientRect();
  reader.container.scrollTop -=
    scrollerBox.bottom - 20 - pdfPoint(reader, 1, [150, 594])[1];
  await frame();
  const popupPoint = pdfPoint(reader, 1, [150, 604]);
  const popupTarget = document.elementFromPoint(...popupPoint)!;
  const pointer = {
    bubbles: true,
    clientX: popupPoint[0],
    clientY: popupPoint[1],
    button: 0,
  };
  popupTarget.dispatchEvent(new PointerEvent("pointerdown", pointer));
  popupTarget.dispatchEvent(new PointerEvent("pointerup", pointer));
  await until(
    "the annotation popup",
    () =>
      reader.root.querySelector("[data-zpr-part='annotation-popup']") !== null,
  );
  const popupElement = reader.root.querySelector(
    "[data-zpr-part='annotation-popup']",
  )!;
  const contents =
    popupElement.querySelector("[data-zpr-part='annotation-contents']")
      ?.textContent ?? "";
  const meta =
    popupElement.querySelector("span.zpr\\:truncate")?.textContent ?? "";
  const inside = () => {
    const box = popupElement.getBoundingClientRect();
    const view = reader.container.getBoundingClientRect();
    return box.top >= view.top - 1 && box.bottom <= view.bottom + 1;
  };
  const inView = await until("the popup in view", inside).then(
    () => true,
    () => false,
  );
  const copiedBefore = host.copied.length;
  popupElement
    .querySelector<HTMLButtonElement>("[data-zpr-part='annotation-copy']")
    ?.click();
  await until("the popup copy", () => host.copied.length > copiedBefore);
  const popupCopied = host.copied.at(-1) ?? "";
  reader.set({ find: { caseSensitive: true } });
  const optionClosed = popupQuery() === null;
  const escape = reader.command("escape");
  await frame();
  const gone =
    reader.root.querySelector("[data-zpr-part='annotation-popup']") === null;

  reader.set({ sidebar: { open: true, panel: "thumbnails" } });
  await until(
    "the thumbnails",
    () =>
      reader.root.querySelectorAll("[data-zpr-part='thumbnail']").length === 3,
  );
  const thumb = reader.root.querySelectorAll("[data-zpr-part='thumbnail']")[1]!;
  await openMenu(host, thumb, center(thumb));
  const thumbnail = await chooseAll(host);

  reader.set({ sidebar: { panel: "outline" } });
  const row = (title: string) =>
    [
      ...reader.root.querySelectorAll<HTMLElement>(
        "[data-zpr-part='outline-item']",
      ),
    ].find((element) => element.textContent?.includes(title));
  await until("the outline", () => row("Introduction") !== undefined);
  await openMenu(host, row("Introduction")!, center(row("Introduction")!));
  const outline = await chooseAll(host);
  await openMenu(host, row("Methods")!, center(row("Methods")!));
  const methods = await chooseAll(host);

  return {
    text,
    textIndex,
    relanded,
    annotation,
    link,
    page,
    thumbnail,
    outline,
    methods,
    targets: targets.map((target) =>
      target.kind === "text"
        ? `text:${target.text}:${target.subpath}`
        : target.kind === "pdf-annotation"
          ? `pdf-annotation:${target.pageIndex}:${target.id}`
          : target.kind === "outline"
            ? `outline:${target.title}:${target.subpath}`
            : `${target.kind}:${target.pageIndex}`,
    ),
    popup: {
      contents,
      meta,
      copied: popupCopied,
      escape,
      gone,
      stale,
      optionClosed,
      inView,
    },
  };
}

async function popupLines(engine: PdfEngine): Promise<string> {
  using mounted = mountFixture(engine, {
    source: bytesSource(
      "lines.pdf",
      pagesPdf(1, {
        0: "<< /Type /Annot /Subtype /Text /Rect [72 600 96 624] /Contents (alpha\\rbeta\\r\\ngamma) >>",
      }),
    ),
  });
  const { reader } = mounted;
  await within("lines ready", reader.whenReady());
  await within("lines settled", reader.settled());
  const point = pdfPoint(reader, 0, [84, 612]);
  const target = document.elementFromPoint(...point)!;
  const pointer = {
    bubbles: true,
    clientX: point[0],
    clientY: point[1],
    button: 0,
  };
  target.dispatchEvent(new PointerEvent("pointerdown", pointer));
  target.dispatchEvent(new PointerEvent("pointerup", pointer));
  await until(
    "the lines popup",
    () =>
      reader.root.querySelector("[data-zpr-part='annotation-contents']") !==
      null,
  );
  return (
    reader.root.querySelector("[data-zpr-part='annotation-contents']")
      ?.textContent ?? ""
  );
}

function titled(): MenusReport["titled"] {
  const host = testHost("chrome.pdf");
  const source = { host, name: "chrome.pdf" };
  return [
    "1 Introduction ",
    "Results and discussion of the experiment on the reading of PDFs",
  ].map((title) => {
    const [item] = builtInItems(
      source,
      { kind: "outline", title, subpath: "#page=1" },
      null,
    );
    item!.run();
    return { title: item!.title, copied: host.copied.at(-1) ?? "" };
  });
}

async function icons(engine: PdfEngine): Promise<MenusReport["icon"]> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await showPage(reader, 3);
  await until(
    "the annotation icon",
    () =>
      reader
        .pageAt(3)
        ?.div.querySelector<HTMLImageElement>(".annotationLayer img")
        ?.src.startsWith("data:image/svg+xml") === true,
  );
  const image = reader
    .pageAt(3)!
    .div.querySelector<HTMLImageElement>(".annotationLayer img")!;
  return { src: image.src.slice(0, 26), alt: image.alt };
}

export async function run(): Promise<MenusReport> {
  installStyles();
  using engine = testEngine();
  return {
    ...(await chromeMenus(engine)),
    icon: await icons(engine),
    lines: await popupLines(engine),
    titled: titled(),
  };
}
