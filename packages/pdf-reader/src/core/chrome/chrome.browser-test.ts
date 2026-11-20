import type {
  NavigateOutcome,
  PageChangeCause,
  PdfEngine,
  PdfReader,
  ReaderState,
} from "#/core/index.ts";

import { bindZoomInput } from "#/core/input/zoom.ts";
import { testHost } from "#test/host.ts";
import {
  addStyle,
  fixtureSource,
  installStyles,
  mountFixture,
  nextEvent,
  part,
  pause,
  stateWhere,
  testEngine,
  within,
} from "#test/reader.ts";

export interface ChromeReport {
  readonly password: {
    readonly asked: Pick<ReaderState, "status" | "passwordRetry">;
    readonly promptShown: boolean;
    readonly message: string;
    readonly focused: boolean;
    readonly wrong: Pick<ReaderState, "status" | "passwordRetry">;
    readonly wrongMessage: string;
    readonly right: Pick<ReaderState, "status" | "pageCount">;
    readonly promptGone: boolean;
    readonly reloadStatuses: readonly string[];
    readonly cancelled: Pick<ReaderState, "status" | "failure">;
    readonly cancelledReady: null | "document";
    readonly cancelledNavigate: NavigateOutcome;
    readonly cancelledRender: null | "page";
    readonly error: string;
    readonly reloadAfterCancel: Pick<ReaderState, "status" | "passwordRetry">;
    readonly reloadMessage: string;
  };
  readonly toolbar: {
    readonly labelInput: { readonly type: string; readonly value: string };
    readonly labelCount: string;
    readonly typedLabel: number;
    readonly numberInput: { readonly type: string; readonly value: string };
    readonly numberCount: string;
    readonly zoomIn: { readonly scale: number; readonly disabled: boolean };
    readonly zoomOut: { readonly scale: number; readonly disabled: boolean };
    readonly wheel: {
      readonly before: number;
      readonly after: number;
      readonly zoom: unknown;
      readonly scrolled: boolean;
      readonly locked: boolean;
      readonly lockedScale: number;
    };
    readonly displayMenu: readonly string[];
    readonly sidebarMenu: readonly {
      readonly id: string;
      readonly checked: boolean | undefined;
      readonly disabled: boolean | undefined;
    }[];
    readonly spread: string;
    readonly themed: { readonly state: boolean; readonly rootClass: boolean };
  };
  readonly sidebar: {
    readonly open: boolean;
    readonly closedDisplay: string;
    readonly thumbnails: number;
    readonly painted: number;
    readonly labels: readonly string[];
    readonly pressed: { readonly pageIndex: number; readonly cause: string };
    readonly current: string | null;
    readonly outline: readonly string[];
    readonly flairs: readonly string[];
    readonly revealed: string | null;
    readonly url: readonly string[];
    readonly dragging: { readonly stored: unknown; readonly shown: number };
    readonly dragged: { readonly stored: unknown; readonly state: number };
    readonly names: readonly string[];
    readonly toggles: readonly {
      readonly label: string | null;
      readonly expanded: string | null;
    }[];
    readonly reactivated: boolean;
    readonly keyboard: readonly number[];
    readonly unlabelled: {
      readonly flairs: readonly string[];
      readonly thumbnails: readonly string[];
    };
  };
  readonly clamped: { readonly main: number; readonly scroller: number };
  readonly contained: {
    readonly outer: readonly number[];
    readonly list: number;
  };
  readonly lockout: {
    readonly beforeDeadline: number;
    readonly afterDeadline: number;
  };
  readonly thumbnailRatios: readonly {
    readonly box: number;
    readonly bitmap: number;
  }[];
  readonly wheelOrigin: {
    readonly offset: { readonly top: number; readonly left: number };
    readonly before: number;
    readonly after: number;
    readonly drift: { readonly x: number; readonly y: number };
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

function submit(reader: PdfReader, value: string): void {
  part<HTMLInputElement>(reader, "password-input").value = value;
  part<HTMLButtonElement>(reader, "password-open").click();
}

async function password(engine: PdfEngine): Promise<ChromeReport["password"]> {
  const source = fixtureSource("pdf-reader/password.pdf");
  using mounted = mountFixture(engine, { source });
  const { reader } = mounted;
  const asked = await within(
    "the password prompt",
    stateWhere(reader, ({ status }) => status === "password"),
  );
  await until(
    "the prompt",
    () => reader.root.querySelector("[data-zpr-part='password']") !== null,
  );
  await frame();
  const promptShown =
    reader.root.querySelector("[data-zpr-part='password']") !== null;
  const message = part(reader, "password-message").textContent ?? "";
  const focused = document.activeElement === part(reader, "password-input");
  submit(reader, "not the password");
  const wrong = await within(
    "the second prompt",
    stateWhere(
      reader,
      ({ status, passwordRetry }) => status === "password" && passwordRetry,
    ),
  );
  await frame();
  const wrongMessage = part(reader, "password-message").textContent ?? "";
  submit(reader, "zotlit");
  const right = await within(
    "the opened document",
    stateWhere(reader, ({ status }) => status === "ready"),
  );
  await frame();
  const promptGone =
    reader.root.querySelector("[data-zpr-part='password']") === null;
  const statuses: string[] = [];
  reader.state.subscribe(({ status }) => {
    if (statuses.at(-1) !== status) statuses.push(status);
  });
  const reloaded = nextEvent(reader, "ready");
  source.change();
  await within("the reload", reloaded);

  const otherSource = fixtureSource("pdf-reader/password.pdf");
  using other = mountFixture(engine, { source: otherSource });
  await within(
    "the other prompt",
    stateWhere(other.reader, ({ status }) => status === "password"),
  );
  await until(
    "the other prompt's buttons",
    () =>
      other.reader.root.querySelector("[data-zpr-part='password-cancel']") !==
      null,
  );
  submit(other.reader, "not the password");
  await within(
    "the other retry prompt",
    stateWhere(
      other.reader,
      ({ status, passwordRetry }) => status === "password" && passwordRetry,
    ),
  );
  await until(
    "the other retry prompt's buttons",
    () =>
      other.reader.root.querySelector("[data-zpr-part='password-cancel']") !==
      null,
  );
  const ready = other.reader.whenReady();
  const navigated = other.reader.navigate("#page=1");
  const rendered = other.reader.whenRendered(0);
  part<HTMLButtonElement>(other.reader, "password-cancel").click();
  const cancelled = other.reader.state.get();
  const cancelledReady = (await within("whenReady", ready)) ? "document" : null;
  const cancelledNavigate = await within("navigate", navigated);
  const cancelledRender = (await within("whenRendered", rendered))
    ? "page"
    : null;
  await frame();
  const error = part(other.reader, "error").textContent ?? "";
  otherSource.change();
  const reloadAfterCancel = await within(
    "the prompt after the reload",
    stateWhere(other.reader, ({ status }) => status === "password"),
  );
  await until(
    "the prompt after the reload",
    () =>
      other.reader.root.querySelector("[data-zpr-part='password-message']") !==
      null,
  );
  return {
    asked: { status: asked.status, passwordRetry: asked.passwordRetry },
    promptShown,
    message,
    focused,
    wrong: { status: wrong.status, passwordRetry: wrong.passwordRetry },
    wrongMessage,
    right: { status: right.status, pageCount: right.pageCount },
    promptGone,
    reloadStatuses: statuses,
    cancelled: { status: cancelled.status, failure: cancelled.failure },
    cancelledReady,
    cancelledNavigate,
    cancelledRender,
    error,
    reloadAfterCancel: {
      status: reloadAfterCancel.status,
      passwordRetry: reloadAfterCancel.passwordRetry,
    },
    reloadMessage: part(other.reader, "password-message").textContent ?? "",
  };
}

function inputOf(reader: PdfReader): { type: string; value: string } {
  const input = part<HTMLInputElement>(reader, "page-input");
  return { type: input.type, value: input.value };
}

async function toolbar(engine: PdfEngine): Promise<ChromeReport["toolbar"]> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/chrome.pdf"),
  });
  const { reader, host } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  await frame();
  const labelInput = inputOf(reader);
  const labelCount = part(reader, "page-count").textContent ?? "";
  const input = part<HTMLInputElement>(reader, "page-input");
  input.value = "2";
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const typedLabel = (
    await within(
      "the labelled page",
      stateWhere(reader, ({ pageIndex }) => pageIndex === 2),
    )
  ).pageIndex;
  reader.set({ showPageLabels: false });
  await frame();
  await frame();
  const numberInput = inputOf(reader);
  const numberCount = part(reader, "page-count").textContent ?? "";
  reader.set({ zoom: 10 });
  await within(
    "zoom 10",
    stateWhere(reader, ({ scale }) => scale === 10),
  );
  await frame();
  const zoomIn = {
    scale: reader.state.get().scale,
    disabled: part<HTMLButtonElement>(reader, "zoom-in").disabled,
  };
  reader.set({ zoom: 0.1 });
  await within(
    "zoom 0.1",
    stateWhere(reader, ({ scale }) => scale === 0.1),
  );
  await frame();
  const zoomOut = {
    scale: reader.state.get().scale,
    disabled: part<HTMLButtonElement>(reader, "zoom-out").disabled,
  };
  reader.set({ zoom: 1 });
  await within(
    "zoom 1",
    stateWhere(reader, ({ scale }) => scale === 1),
  );
  const wheelAt = (init: WheelEventInit) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 200,
      deltaMode: 0,
      ...init,
    });
    reader.container.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const before = reader.state.get().scale;
  wheelAt({ ctrlKey: true, deltaY: -90 });
  const zoomed = await within(
    "the wheel zoom",
    stateWhere(reader, ({ scale }) => scale > 1),
  );
  const scrolled = !wheelAt({ deltaY: 40 });
  const locked = wheelAt({ ctrlKey: true, deltaY: -90 });
  await frame();
  const wheel = {
    before,
    after: zoomed.scale,
    zoom: zoomed.zoom,
    scrolled,
    locked,
    lockedScale: reader.state.get().scale,
  };
  part<HTMLButtonElement>(reader, "display-menu").click();
  const displayMenu = host.menus.at(-1)?.map((item) => item.id) ?? [];
  host.choose("spread-odd");
  host.choose("themed");
  await frame();
  const spread = reader.state.get().spread;
  const themed = {
    state: reader.state.get().themed,
    rootClass: reader.root.classList.contains("mod-themed"),
  };
  part<HTMLButtonElement>(reader, "sidebar-menu").click();
  const sidebarMenu =
    host.menus.at(-1)?.map(({ id, checked, disabled }) => ({
      id,
      checked,
      disabled,
    })) ?? [];
  return {
    labelInput,
    labelCount,
    typedLabel,
    numberInput,
    numberCount,
    zoomIn,
    zoomOut,
    wheel,
    displayMenu,
    sidebarMenu,
    spread,
    themed,
  };
}

async function sidebar(engine: PdfEngine): Promise<ChromeReport["sidebar"]> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/chrome.pdf"),
  });
  const { reader, host } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  const closedDisplay = getComputedStyle(part(reader, "sidebar")).display;
  part<HTMLButtonElement>(reader, "sidebar-toggle").click();
  await within(
    "the open sidebar",
    stateWhere(reader, ({ sidebar }) => sidebar.open),
  );
  const thumbnails = () => [
    ...reader.root.querySelectorAll<HTMLElement>("[data-zpr-part='thumbnail']"),
  ];
  await until("the thumbnails", () =>
    thumbnails().some((item) => item.querySelector("canvas[data-painted]")),
  );
  const causes: PageChangeCause[] = [];
  reader.on("page-change", ({ cause }) => causes.push(cause));
  thumbnails()[1]?.click();
  const pressed = await within(
    "the thumbnail press",
    stateWhere(reader, ({ pageIndex }) => pageIndex === 1),
  );
  await until("the current thumbnail", () =>
    thumbnails().some((item) => item.hasAttribute("data-current")),
  );
  const current =
    thumbnails().find((item) => item.hasAttribute("data-current"))?.dataset
      .pageNumber ?? null;
  const painted = thumbnails().filter((item) =>
    item.querySelector("canvas[data-painted]"),
  ).length;
  const labels = thumbnails().map((item) => item.textContent ?? "");
  const names = thumbnails().map(
    (item) => item.getAttribute("aria-label") ?? "",
  );
  const count = thumbnails().length;
  reader.set({ sidebar: { panel: "outline" } });
  const rows = () => [
    ...reader.root.querySelectorAll<HTMLElement>(
      "[data-zpr-part='outline-item']",
    ),
  ];
  await until("the outline", () => rows().length >= 3);
  await until(
    "the outline pages",
    () =>
      rows().filter((row) => row.lastElementChild?.tagName === "SPAN").length >=
      2,
  );
  const outline = rows().map(
    (row) => row.querySelector("button:not([aria-label])")?.textContent ?? "",
  );
  const flairs = rows().map((row) =>
    row.lastElementChild?.tagName === "SPAN"
      ? (row.lastElementChild.textContent ?? "")
      : "",
  );
  await reader.navigate({ pageIndex: 2 });
  part<HTMLButtonElement>(reader, "sidebar-menu").click();
  host.choose("reveal-in-outline");
  await until("the revealed item", () =>
    rows().some((row) => row.hasAttribute("data-active")),
  );
  const revealed =
    rows()
      .find((row) => row.hasAttribute("data-active"))
      ?.querySelector("button:not([aria-label])")?.textContent ?? null;
  const toggles = rows().flatMap((row) => {
    const toggle = row.querySelector("button[aria-label]");
    return toggle
      ? [
          {
            label: toggle.getAttribute("aria-label"),
            expanded: toggle.getAttribute("aria-expanded"),
          },
        ]
      : [];
  });
  rows()
    .find((row) => row.textContent?.includes("Project site"))
    ?.querySelector<HTMLButtonElement>("button:not([aria-label])")
    ?.click();
  const resizer = part(reader, "sidebar-resizer");
  const left = part(reader, "content").getBoundingClientRect().left;
  const pointer = (type: string, x: number) =>
    resizer.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        clientX: left + x,
        clientY: 100,
      }),
    );
  pointer("pointerdown", 140);
  pointer("pointermove", 180);
  pointer("pointermove", 220);
  await frame();
  const dragging = {
    stored: (host.storage.get("sidebar") as { width?: number }).width,
    shown: part(reader, "sidebar").getBoundingClientRect().width,
  };
  pointer("pointerup", 220);
  await frame();
  const dragged = {
    stored: (host.storage.get("sidebar") as { width?: number }).width,
    state: reader.state.get().sidebar.width,
  };
  resizer.focus();
  const keyboard: number[] = [];
  for (const key of ["ArrowRight", "ArrowLeft", "ArrowLeft", "Home", "End"]) {
    resizer.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
    await frame();
    keyboard.push(reader.state.get().sidebar.width);
  }
  keyboard.push(
    Math.round(part(reader, "content").getBoundingClientRect().width / 2),
  );
  reader.set({ sidebar: { panel: "thumbnails" } });
  await reader.navigate({ pageIndex: 0 });
  await within("settled on page 1", reader.settled());
  reader.set({ sidebar: { panel: "outline" } });
  await until("the outline again", () => rows().length >= 3);
  await pause(300);
  const reactivated = rows().some((row) => row.hasAttribute("data-active"));
  reader.set({ showPageLabels: false });
  await frame();
  const unlabelledFlairs = rows().map((row) =>
    row.lastElementChild?.tagName === "SPAN"
      ? (row.lastElementChild.textContent ?? "")
      : "",
  );
  reader.set({ sidebar: { panel: "thumbnails" } });
  await until("the unlabelled thumbnails", () => thumbnails().length === 3);
  const unlabelled = {
    flairs: unlabelledFlairs,
    thumbnails: thumbnails().map(
      (item) => `${item.textContent}:${item.getAttribute("aria-label")}`,
    ),
  };
  return {
    open: reader.state.get().sidebar.open,
    closedDisplay,
    thumbnails: count,
    painted,
    labels,
    pressed: { pageIndex: pressed.pageIndex, cause: causes[0] ?? "none" },
    current,
    outline,
    flairs,
    revealed,
    url: host.opened,
    dragging,
    dragged,
    names,
    toggles,
    reactivated,
    keyboard,
    unlabelled,
  };
}

async function clamped(engine: PdfEngine): Promise<ChromeReport["clamped"]> {
  const host = testHost();
  host.storage.set("sidebar", { open: true, panel: "thumbnails", width: 500 });
  using mounted = mountFixture(engine, {
    host,
    source: fixtureSource("pdf-reader/chrome.pdf"),
  });
  const { reader, element } = mounted;
  addStyle(element, "width: 400px;");
  await within("clamped ready", reader.whenReady());
  await within("clamped settled", reader.settled());
  return {
    main: part(reader, "viewport").clientWidth,
    scroller: reader.container.clientWidth,
  };
}

async function contained(
  engine: PdfEngine,
): Promise<ChromeReport["contained"]> {
  const outer = document.createElement("div");
  addStyle(outer, "height: 300px; overflow-y: auto;");
  const above = document.createElement("div");
  addStyle(above, "height: 100px;");
  const below = document.createElement("div");
  addStyle(below, "height: 1000px;");
  document.body.append(outer);
  using mounted = mountFixture(engine, {
    source: fixtureSource("sandve-2013/sandve-2013.pdf"),
  });
  const { reader, element } = mounted;
  outer.append(above, element, below);
  await within("contained ready", reader.whenReady());
  await within("contained settled", reader.settled());
  const scrolls = [outer.scrollTop];
  reader.set({ sidebar: { open: true, panel: "thumbnails" } });
  await until(
    "the contained thumbnails",
    () =>
      reader.root.querySelectorAll("[data-zpr-part='thumbnail']").length > 0,
  );
  await pause(200);
  scrolls.push(outer.scrollTop);
  await reader.navigate({ pageIndex: 3 });
  await within("contained page 4", reader.settled());
  await pause(200);
  scrolls.push(outer.scrollTop);
  const list = part(reader, "thumbnails").scrollTop;
  outer.remove();
  return { outer: scrolls, list };
}

function lockout(): ChromeReport["lockout"] {
  const container = document.createElement("div");
  document.body.append(container);
  const lifetime = new AbortController();
  let clock = 0;
  let zooms = 0;
  bindZoomInput({
    container,
    signal: lifetime.signal,
    enabled: () => true,
    now: () => clock,
    scale: () => 1,
    zoom: () => {
      zooms++;
    },
    pan: () => {},
  });
  const wheel = (ctrlKey: boolean) =>
    container.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey,
        deltaMode: 0,
        deltaY: ctrlKey ? -90 : 40,
      }),
    );
  wheel(false);
  clock = 999;
  wheel(true);
  const beforeDeadline = zooms;
  clock = 1001;
  wheel(true);
  const afterDeadline = zooms;
  lifetime.abort();
  container.remove();
  return { beforeDeadline, afterDeadline };
}

async function thumbnailRatios(
  engine: PdfEngine,
): Promise<ChromeReport["thumbnailRatios"]> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/mixed-sizes.pdf"),
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  reader.set({ sidebar: { open: true, panel: "thumbnails" } });
  const painted = () => [
    ...reader.root.querySelectorAll<HTMLCanvasElement>(
      "[data-zpr-part='thumbnail'] canvas[data-painted]",
    ),
  ];
  await until("both thumbnails", () => painted().length === 2);
  await frame();
  return painted().map((canvas) => ({
    box: canvas.clientWidth / canvas.clientHeight,
    bitmap: canvas.width / canvas.height,
  }));
}

async function wheelOrigin(
  engine: PdfEngine,
): Promise<ChromeReport["wheelOrigin"]> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/chrome.pdf"),
  });
  const { reader, element } = mounted;
  addStyle(element, "margin-top: 180px; margin-left: 140px;");
  await within("ready", reader.whenReady());
  reader.set({ zoom: 1.5 });
  await within(
    "zoom 1.5",
    stateWhere(reader, ({ scale }) => scale === 1.5),
  );
  await within("settled", reader.settled());
  await frame();
  const box = reader.container.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const pageOf = () =>
    reader.root.querySelector<HTMLElement>('.page[data-page-number="1"]')!;
  const pointAt = () => {
    const rect = pageOf().getBoundingClientRect();
    const { scale } = reader.state.get();
    return { x: (x - rect.left) / scale, y: (y - rect.top) / scale };
  };
  const start = pointAt();
  reader.container.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      deltaMode: 0,
      ctrlKey: true,
      deltaY: -90,
    }),
  );
  const zoomed = await within(
    "the wheel zoom",
    stateWhere(reader, ({ scale }) => scale > 1.5),
  );
  await within("settled", reader.settled());
  await frame();
  const end = pointAt();
  return {
    offset: {
      top: Math.round(box.top),
      left: Math.round(box.left),
    },
    before: 1.5,
    after: zoomed.scale,
    drift: {
      x: Math.round((end.x - start.x) * zoomed.scale),
      y: Math.round((end.y - start.y) * zoomed.scale),
    },
  };
}

export async function run(): Promise<ChromeReport> {
  installStyles();
  using engine = testEngine();
  return {
    password: await password(engine),
    toolbar: await toolbar(engine),
    sidebar: await sidebar(engine),
    clamped: await clamped(engine),
    contained: await contained(engine),
    lockout: lockout(),
    thumbnailRatios: await thumbnailRatios(engine),
    wheelOrigin: await wheelOrigin(engine),
  };
}
