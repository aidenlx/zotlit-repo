import type { PdfAnnotation } from "#/core/annotations/annotations.ts";
import type { ChromeModel, OutlineNode } from "#/core/chrome/model.ts";
import type { Held } from "#/core/document/lifetime.ts";
import type { MenuItem, ReaderHost } from "#/core/host.ts";
import type { TextRange } from "#/core/subpath/legacy-selection.ts";
import type { Subpath } from "#/core/subpath/parse.ts";
import type { PageTheme } from "#/core/theme/theme.ts";
import type {
  ContextTarget,
  MountOptions,
  PdfReader,
  ReaderCommand,
  ReaderIntent,
  ReaderPage,
  ReaderState,
} from "#/core/types.ts";
import type { Kept } from "#/core/viewer/navigation.ts";
import type {
  PageEvent,
  PageView,
  ReaderViewer,
  ScaleEvent,
  ViewArea,
} from "#/core/viewer/viewer.ts";

import { showPopup } from "./annotations/popup.tsx";
import type { ChromeElements } from "./chrome/root.tsx";
import { renderChrome } from "./chrome/root.tsx";

import {
  annotatedText,
  annotationDate,
  PageAnnotations,
  pagePoint,
  showIcons,
} from "#/core/annotations/annotations.ts";
import { DocumentLifetime } from "#/core/document/lifetime.ts";
import { Emitter } from "#/core/extensions/events.ts";
import { ExtensionHost } from "#/core/extensions/host.ts";
import { FindSession } from "#/core/find/find.ts";
import { bindZoomInput } from "#/core/input/zoom.ts";
import {
  annotationSubpath,
  builtInItems,
  cleanText,
  quoteText,
  selectionRange,
} from "#/core/menus/menus.ts";
import { writePosition } from "#/core/persist/position.ts";
import {
  readFindOptions,
  readSidebar,
  readThemed,
  writeFindOptions,
  writeSidebar,
  writeThemed,
} from "#/core/persist/settings.ts";
import { makeReaderAtoms } from "#/core/state/atoms.ts";
import { intended, opened, scaled } from "#/core/state/transitions.ts";
import { clampZoom, stepped, zoomOf } from "#/core/state/zoom.ts";
import { scrollNearest } from "#/core/subpath/apply.ts";
import { parseSubpath } from "#/core/subpath/parse.ts";
import { readPageTheme, samePageTheme } from "#/core/theme/theme.ts";
import { Navigation } from "#/core/viewer/navigation.ts";
import { PageRegistry } from "#/core/viewer/pages.ts";
import { createViewer, hasStarted } from "#/core/viewer/viewer.ts";

const CLICK_SLOP = 5;
interface RawOutline {
  readonly title: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly dest?: string | readonly unknown[] | null;
  readonly url?: string | null;
  readonly action?: string | null;
  readonly items?: readonly RawOutline[];
}

function outlineOf(items: readonly RawOutline[]): OutlineNode[] {
  return items.map((item) => ({
    title: item.title,
    bold: item.bold === true,
    italic: item.italic === true,
    dest: item.dest ?? null,
    url: item.url ?? null,
    action: item.action ?? null,
    items: outlineOf(item.items ?? []),
  }));
}

function sameFindOptions(a: ReaderState["find"], b: ReaderState["find"]) {
  return (
    a.caseSensitive === b.caseSensitive &&
    a.highlightAll === b.highlightAll &&
    a.matchDiacritics === b.matchDiacritics &&
    a.entireWord === b.entireWord
  );
}

class Reader<H> {
  readonly handle: PdfReader;
  readonly #options: MountOptions<H>;
  readonly #host: ReaderHost;
  readonly #atoms = makeReaderAtoms((error, phase) =>
    this.#host.report(error, { phase }),
  );
  readonly #emitter: Emitter;
  readonly #root: HTMLElement;
  readonly #chrome: ChromeElements & Disposable;
  readonly #extensions: ExtensionHost<H>;
  readonly #mountSubpath: Subpath | null;
  readonly #stopWatch: () => void;
  readonly #stopTheme: () => void;
  readonly #viewer: ReaderViewer;
  readonly #pages: PageRegistry;
  readonly #find: FindSession;
  readonly #lifetime: DocumentLifetime<Kept>;
  readonly #navigation: Navigation;
  readonly #annotations = new PageAnnotations();
  #popup: { readonly id: string; readonly view: Disposable } | null = null;
  #press: AbortController | null = null;
  #resize: ResizeObserver | null = null;
  #disposed = false;

  constructor(element: HTMLElement, options: MountOptions<H>) {
    this.#options = options;
    this.#host = options.host;
    this.#emitter = new Emitter((error, event) => {
      this.#host.report(error, { phase: `event:${event}` });
    });
    const document = element.ownerDocument;
    this.#root = document.createElement("div");
    this.#root.className =
      "zpr-root zpr:relative zpr:flex zpr:h-full zpr:flex-col";
    this.#root.dataset.zprKind = options.kind;
    element.append(this.#root);
    this.#restoreSettings();
    this.#chrome = renderChrome(this.#root, this.#chromeModel());
    [this.#viewer, this.#pages] = this.#buildViewer();
    this.#find = new FindSession(this.#viewer, {
      read: () => this.#atoms.state.get().find,
      update: (change) =>
        this.#atoms.update((state) => {
          const find = change(state.find);
          return find === state.find ? state : { ...state, find };
        }),
      searched: () => {
        this.#closePopup();
        this.#navigation.clearHighlight();
      },
    });
    this.#lifetime = new DocumentLifetime<Kept>({
      engine: options.engine,
      source: options.source,
      host: this.#host,
      root: this.#root,
      deferUntilVisible: options.deferUntilVisible === true,
      atoms: this.#atoms,
      emitter: this.#emitter,
      viewer: this.#viewer,
      pages: this.#pages,
      view: {
        theme: () => {
          this.#applyTheme();
        },
        show: (held, kept) => this.#show(held, kept),
        resumed: () => this.#find.resume(),
        closing: () => this.#closing(),
        quiet: () => this.#navigation.quiet(),
      },
    });
    this.#mountSubpath = options.subpath ? parseSubpath(options.subpath) : null;
    this.#navigation = new Navigation({
      kind: options.kind,
      host: this.#host,
      atoms: this.#atoms,
      emitter: this.#emitter,
      viewer: this.#viewer,
      pages: this.#pages,
      scroller: this.#chrome.scroller,
      mount: this.#mountSubpath,
      lifetime: this.#lifetime,
    });
    this.#bindInput();
    this.handle = this.#makeHandle();
    this.#extensions = new ExtensionHost(this.#host);
    this.#extensions.attach(this.handle, options.extensions ?? [], {
      host: options.hostContext,
      subpath: this.#mountSubpath,
    });
    this.#stopWatch =
      options.source.watch?.(() => this.#reload()) ?? (() => {});
    this.#stopTheme =
      this.#host.watchTheme?.(() => this.#themeChanged()) ?? (() => {});
    this.#observeResize();
    this.#lifetime.open();
  }

  #buildViewer(): [ReaderViewer, PageRegistry] {
    const viewer = createViewer({
      container: this.#chrome.scroller,
      viewer: this.#chrome.viewer,
      removePageBorders: this.#options.kind !== "view",
      t: (key, vars) => this.#host.t(key, vars),
    });
    const pages = new PageRegistry(viewer, (page) => this.#rendered(page));
    viewer.on<PageEvent>("pagerender", (event) => pages.started(event));
    viewer.on<PageEvent>("pagerendered", (event) => pages.painted(event));
    viewer.on<PageEvent>("textlayerrendered", (event) =>
      pages.textPainted(event),
    );
    viewer.on<ScaleEvent>("scalechanging", (event) => {
      this.#atoms.update((state) =>
        scaled(state, event.scale, zoomOf(event.presetValue, event.scale)),
      );
    });
    viewer.on<ViewArea>("updateviewarea", (event) => this.#keep(event));
    viewer.on<PageEvent>("annotationlayerrendered", (event) => {
      const view = pages.view(event.pageNumber - 1);
      if (view) showIcons(view.div, (key, vars) => this.#host.t(key, vars));
    });
    viewer.on<{ readonly query: string | readonly string[] }>(
      "findfromurlhash",
      ({ query }) => {
        this.#find.fromHash(
          typeof query === "string" ? query : query.join(" "),
        );
      },
    );
    return [viewer, pages];
  }

  #restoreSettings(): void {
    const host = this.#host;
    const find = readFindOptions(host);
    const sidebar = this.#options.kind === "view" ? readSidebar(host) : null;
    this.#atoms.update((state) =>
      intended(state, {
        themed: readThemed(host),
        ...(sidebar ? { sidebar } : {}),
        ...(find ? { find } : {}),
      }),
    );
    this.#root.classList.toggle("mod-themed", this.#atoms.state.get().themed);
  }

  #chromeModel(): ChromeModel {
    const atoms = this.#atoms;
    return {
      host: this.#host,
      kind: this.#options.kind,
      registry: atoms.registry,
      state: atoms.stateAtom,
      document: atoms.documentAtom,
      outline: atoms.outlineAtom,
      labels: atoms.labelsAtom,
      reveal: atoms.revealAtom,
      pageTheme: atoms.pageThemeAtom,
      findInput: { current: null },
      actions: {
        set: (intent) => this.#set(intent),
        command: (command) => this.#command(command),
        goToPage: (pageIndex) => {
          if (!this.#disposed) void this.#navigation.navigate({ pageIndex });
        },
        goToDestination: (dest) => this.#navigation.goToDestination(dest),
        openUrl: (url) => this.#host.openExternal(url),
        runAction: (action) => this.#navigation.runAction(action),
        revealOutline: () => {
          this.#set({ sidebar: { open: true, panel: "outline" } });
          atoms.write(atoms.revealAtom, true);
        },
        pageOf: (dest) => this.#pageOf(dest),
        sectionSubpath: (dest) => this.#sectionSubpath(dest),
        renderThumbnail: (pageIndex, canvas, options) =>
          this.#renderThumbnail(pageIndex, canvas, options),
        submitPassword: (password) => this.#lifetime.submitPassword(password),
        cancelPassword: () => this.#lifetime.cancelPassword(),
        showMenu: (target, at) => this.#showMenu([target], at, null),
      },
    };
  }

  #bindInput(): void {
    const { scroller } = this.#chrome;
    const { signal } = this.#viewer;
    bindZoomInput({
      container: scroller,
      signal,
      enabled: () => this.#navigation.shown && !this.#disposed,
      now: () => performance.now(),
      scale: () => this.#navigation.scale(),
      zoom: (change) => this.#navigation.zoomBy(change),
      pan: (dx, dy) => this.#navigation.pan(dx, dy),
    });
    scroller.addEventListener(
      "contextmenu",
      (event) => this.#contextMenu(event),
      { signal },
    );
    scroller.addEventListener(
      "pointerdown",
      (event) => this.#pointerDown(event),
      { signal },
    );
  }

  #pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || event.ctrlKey) return;
    const target = event.target as Element | null;
    if (target?.closest("[data-zpr-part='annotation-popup']")) return;
    this.#closePopup();
    this.#navigation.clearHighlight();
    this.#press?.abort();
    const press = new AbortController();
    this.#press = press;
    const document = this.#root.ownerDocument;
    const { clientX, clientY } = event;
    const signal = AbortSignal.any([press.signal, this.#viewer.signal]);
    const up = (released: PointerEvent) => {
      press.abort();
      if (
        Math.hypot(released.clientX - clientX, released.clientY - clientY) >
        CLICK_SLOP
      ) {
        return;
      }
      void this.#openPopupAt(target, clientX, clientY);
    };
    document.addEventListener("pointerup", up, { capture: true, signal });
    document.addEventListener("pointercancel", () => press.abort(), {
      capture: true,
      signal,
    });
  }

  #pageAt(target: Element | null): PageView | null {
    const div = target?.closest<HTMLElement>(".page[data-page-number]");
    if (!div || !this.#chrome.scroller.contains(div)) return null;
    const pageIndex = Number(div.dataset.pageNumber) - 1;
    return Number.isInteger(pageIndex) ? this.#pages.view(pageIndex) : null;
  }

  async #annotationAt(
    view: PageView,
    clientX: number,
    clientY: number,
  ): Promise<PdfAnnotation | null> {
    return this.#annotations.at(view, pagePoint(view, clientX, clientY));
  }

  async #openPopupAt(
    target: Element | null,
    clientX: number,
    clientY: number,
  ): Promise<void> {
    const held = this.#lifetime.current;
    const view = this.#pageAt(target);
    if (!held || !view) return;
    const annotation = await this.#annotationAt(view, clientX, clientY);
    if (
      !annotation ||
      annotation.subtype === "Widget" ||
      annotation.subtype === "Link" ||
      this.#lifetime.current !== held ||
      this.#popup?.id === annotation.id
    ) {
      return;
    }
    const pageIndex = view.id - 1;
    const page = this.#pages.page(pageIndex);
    if (!page) return;
    const quote = await annotatedText(
      held.lease.document,
      pageIndex,
      annotation,
    );
    if (this.#lifetime.current !== held) return;
    const contents = (annotation.contentsObj?.str ?? "").replaceAll(
      /\r\n?/g,
      "\n",
    );
    const link = this.#host.link(annotationSubpath(pageIndex, annotation.id));
    const copyText = quoteText(quote, link, contents);
    this.#closePopup();
    const popup = showPopup(page.layer("zpr-annotation-popup"), {
      host: this.#host,
      content: {
        id: annotation.id,
        contents,
        title: annotation.titleObj?.str ?? "",
        date: annotationDate(annotation),
        copyText,
      },
      box: page.toBox([
        annotation.rect[0] ?? 0,
        annotation.rect[1] ?? 0,
        annotation.rect[2] ?? 0,
        annotation.rect[3] ?? 0,
      ]),
    });
    this.#popup = { id: annotation.id, view: popup };
    scrollNearest(this.#chrome.scroller, popup.element, "smooth");
  }

  #closePopup(): boolean {
    const popup = this.#popup;
    if (!popup) return false;
    this.#popup = null;
    popup.view[Symbol.dispose]();
    return true;
  }

  #menuSource() {
    return { host: this.#host, name: this.#options.source.name };
  }

  #contextMenu(event: MouseEvent): void {
    const target = event.target as Element | null;
    const view = this.#pageAt(target);
    const held = this.#lifetime.current;
    if (!view || !held) return;
    event.preventDefault();
    this.#closePopup();
    this.#navigation.clearHighlight();
    const pageIndex = view.id - 1;
    const targets: ContextTarget[] = [];
    const selection = this.#root.ownerDocument.getSelection();
    const range =
      selection && selection.rangeCount > 0 && !selection.isCollapsed
        ? selection.getRangeAt(0)
        : null;
    let textTarget: Promise<ContextTarget | null> = Promise.resolve(null);
    if (
      range &&
      this.#chrome.scroller.contains(range.commonAncestorContainer)
    ) {
      const text = cleanText(selection!.toString());
      if (text) {
        textTarget = this.#textTarget(held, view, {
          text,
          indexes: selectionRange(view, range),
        });
      }
    }
    const { clientX, clientY } = event;
    void Promise.all([
      textTarget,
      this.#annotationAt(view, clientX, clientY),
    ]).then(async ([text, annotation]) => {
      if (this.#lifetime.current !== held) return;
      if (text) targets.push(text);
      let quote: string | null = null;
      if (annotation && annotation.subtype !== "Widget") {
        targets.push({ kind: "pdf-annotation", pageIndex, id: annotation.id });
        quote = await annotatedText(held.lease.document, pageIndex, annotation);
      }
      if (targets.length === 0) {
        targets.push({
          kind: "page",
          pageIndex,
          point: pagePoint(view, clientX, clientY),
        });
      }
      if (this.#lifetime.current === held)
        this.#showMenu(targets, event, quote);
    });
  }

  async #textTarget(
    held: Held,
    view: PageView,
    {
      text,
      indexes,
    }: { readonly text: string; readonly indexes: TextRange | null },
  ): Promise<ContextTarget> {
    const pageIndex = view.id - 1;
    const mapped = indexes && (await held.links.linkRange(view, indexes));
    return {
      kind: "text",
      text,
      pageIndex,
      subpath: mapped
        ? `#page=${pageIndex + 1}&selection=${mapped.join(",")}`
        : `#page=${pageIndex + 1}`,
    };
  }

  #showMenu(
    targets: readonly ContextTarget[],
    at: MouseEvent | HTMLElement,
    annotationQuote: string | null,
  ): void {
    if (this.#disposed) return;
    const source = this.#menuSource();
    const items: MenuItem[] = [];
    for (const target of targets) {
      items.push(...builtInItems(source, target, annotationQuote));
    }
    for (const target of targets) {
      items.push(...this.#extensions.contextMenu(target));
    }
    if (items.length > 0) this.#host.menu(at, items);
  }

  async #pageOf(dest: string | readonly unknown[]): Promise<number | null> {
    return (await this.#navigation.destination(dest))?.pageIndex ?? null;
  }

  async #sectionSubpath(
    dest: string | readonly unknown[],
  ): Promise<string | null> {
    const resolved = await this.#navigation.destination(dest);
    if (!resolved) return null;
    const { explicit, pageIndex } = resolved;
    let subpath = `page=${pageIndex + 1}`;
    const [, kind, left, top, zoom] = explicit as [
      unknown,
      { readonly name?: string } | undefined,
      number | null,
      number | null,
      number | null,
    ];
    if (kind?.name === "XYZ" && explicit.length === 5 && left !== null) {
      const parts = [left];
      if (top !== null) {
        parts.push(top);
        if (zoom !== null) parts.push(zoom);
      }
      subpath += `&offset=${parts.join(",")}`;
    }
    return `#${subpath}`;
  }

  async #renderThumbnail(
    pageIndex: number,
    canvas: HTMLCanvasElement,
    options: { readonly signal: AbortSignal; readonly theme: PageTheme },
  ): Promise<void> {
    const { signal, theme } = options;
    const held = this.#lifetime.current;
    const page = await held?.lease.document.page(pageIndex);
    if (!page || signal.aborted) return;
    const natural = page.getViewport({ scale: 1 });
    const window = canvas.ownerDocument.defaultView;
    const ratio = window?.devicePixelRatio ?? 1;
    const width = Number.parseFloat(
      window?.getComputedStyle(canvas).width ?? "",
    );
    const viewport = page.getViewport({
      scale: (width * ratio) / natural.width,
    });
    const drawn = canvas.ownerDocument.createElement("canvas");
    drawn.width = Math.round(viewport.width);
    drawn.height = Math.round(viewport.height);
    const { background, invert } = theme;
    const task = page.render({
      canvas: drawn,
      viewport,
      invert,
      ...(background === null ? {} : { background }),
    });
    const cancel = () => task.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await task.promise;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
    if (signal.aborted) return;
    canvas.width = drawn.width;
    canvas.height = drawn.height;
    canvas.getContext("2d")!.drawImage(drawn, 0, 0);
  }

  #observeResize(): void {
    this.#resize?.disconnect();
    const Observer = this.#root.ownerDocument.defaultView?.ResizeObserver;
    if (!Observer) return;
    this.#resize = new Observer(() => this.#navigation.fit());
    this.#resize.observe(this.#chrome.scroller);
  }

  #show(held: Held, kept: Kept | null): Promise<void> {
    const { document } = held.lease;
    const { pdfViewer } = this.#viewer;
    pdfViewer.setPageLabels(held.labels ? [...held.labels] : null);
    this.#atoms.update((state) =>
      opened(state, {
        pageCount: document.proxy.numPages,
        labels: held.labels,
      }),
    );
    this.#atoms.write(this.#atoms.labelsAtom, held.labels);
    this.#atoms.setDocument(document);
    this.#loadOutline(held);
    this.#emitter.emit("document", { document });
    if (this.#lifetime.current !== held) return Promise.resolve();
    return this.#navigation.begin(held, kept);
  }

  #loadOutline(held: Held): void {
    const { outlineAtom } = this.#atoms;
    held.headless.proxy.getOutline().then(
      (items) => {
        if (this.#lifetime.current !== held) return;
        this.#atoms.write(
          outlineAtom,
          items?.length
            ? outlineOf(items as unknown as readonly RawOutline[])
            : null,
        );
      },
      () => {
        if (this.#lifetime.current === held)
          this.#atoms.write(outlineAtom, null);
      },
    );
  }

  #closing(): void {
    this.#navigation.closing();
    this.#closePopup();
    this.#annotations.clear();
    this.#find.reset();
    this.#atoms.write(this.#atoms.outlineAtom, null);
    this.#atoms.write(this.#atoms.labelsAtom, null);
    this.#atoms.write(this.#atoms.revealAtom, false);
  }

  #reload(): void {
    if (this.#disposed) return;
    this.#lifetime.reload(this.#navigation.kept());
  }

  #keep({ location }: ViewArea): void {
    const held = this.#lifetime.current;
    if (!held || !this.#navigation.shown || this.#options.kind !== "view")
      return;
    writePosition(this.#host, {
      fingerprint: held.lease.document.fingerprint,
      pageIndex: location.pageNumber - 1,
      left: location.left,
      top: location.top,
      spread: this.#atoms.state.get().spread,
    });
  }

  #keepNow(): void {
    const location = this.#viewer.pdfViewer._location as
      | ViewArea["location"]
      | undefined;
    if (location) this.#keep({ location });
  }

  #rendered(page: ReaderPage): void {
    this.#navigation.rendered(page);
    this.#extensions.drawPage(page);
    this.#emitter.emit("page-rendered", { page });
    this.#lifetime.rendered(page);
  }

  #set(intent: ReaderIntent): void {
    if (this.#disposed) return;
    const zoom =
      typeof intent.zoom === "number" ? clampZoom(intent.zoom) : intent.zoom;
    const before = this.#atoms.state.get();
    this.#atoms.update((state) =>
      intended(state, zoom === undefined ? intent : { ...intent, zoom }),
    );
    const after = this.#atoms.state.get();
    this.#changed(before, after);
    if (intent.find?.open === true && before.find.open) {
      this.#chrome.focusFind();
    }
    this.#navigation.set({ spread: intent.spread, zoom });
  }

  #changed(before: ReaderState, after: ReaderState): void {
    const host = this.#host;
    if (before.find !== after.find) {
      this.#find.changed(before.find, after.find);
      if (!sameFindOptions(before.find, after.find)) {
        writeFindOptions(host, after.find);
      }
    }
    if (before.sidebar !== after.sidebar && this.#options.kind === "view") {
      writeSidebar(host, after.sidebar);
    }
    if (before.themed !== after.themed) {
      writeThemed(host, after.themed);
      this.#root.classList.toggle("mod-themed", after.themed);
      this.#themeChanged();
    }
    if (before.spread !== after.spread && this.#navigation.shown)
      this.#keepNow();
  }

  #applyTheme(): boolean {
    const next = readPageTheme(this.#root, this.#atoms.state.get().themed);
    this.#root.toggleAttribute("data-zpr-inverted", next.invert);
    const { registry, pageThemeAtom } = this.#atoms;
    if (samePageTheme(next, registry.get(pageThemeAtom))) return false;
    this.#viewer.paint(next);
    this.#atoms.write(pageThemeAtom, next);
    return true;
  }

  #themeChanged(): void {
    if (this.#disposed) return;
    if (this.#applyTheme()) void this.#redraw();
  }

  #command(command: ReaderCommand): boolean {
    if (this.#disposed) return false;
    switch (command) {
      case "zoom-in":
      case "zoom-out": {
        if (!this.#navigation.shown) return false;
        const { scale } = this.#atoms.state.get();
        const next = stepped(scale, command === "zoom-in" ? 1 : -1);
        if (next === scale) return false;
        this.#set({ zoom: next });
        return true;
      }
      case "next-page":
        return this.#navigation.step("next");
      case "previous-page":
        return this.#navigation.step("previous");
      case "escape": {
        const popup = this.#closePopup();
        const highlight = this.#navigation.clearHighlight();
        const find = this.#atoms.state.get().find.open;
        if (find) this.#set({ find: { open: false } });
        return popup || highlight || find;
      }
      case "find-next":
      case "find-previous":
        return this.#find.again(command === "find-previous");
    }
  }

  async #redraw(pageIndex?: number): Promise<void> {
    if (this.#disposed || !this.#navigation.shown) return;
    const visible = new Set(this.#viewer.visiblePages());
    const views =
      pageIndex === undefined
        ? Array.from({ length: this.#viewer.pageCount() }, (_, index) =>
            this.#viewer.pageView(index),
          ).filter(
            (view): view is PageView => view !== null && hasStarted(view),
          )
        : [this.#pages.view(pageIndex)].filter(
            (view): view is PageView => view?.pdfPage != null,
          );
    const waits: Promise<unknown>[] = [];
    for (const view of views) {
      view.reset();
      if (pageIndex !== undefined || visible.has(view)) {
        waits.push(this.#lifetime.whenRendered(view.id - 1));
      }
    }
    if (pageIndex !== undefined && views[0]) this.#viewer.renderView(views[0]);
    else this.#viewer.pdfViewer.update();
    await Promise.all(waits);
  }

  #windowMigrated(): void {
    if (this.#disposed) return;
    this.#observeResize();
    this.#reload();
    const window = this.#root.ownerDocument.defaultView;
    if (window) this.#emitter.emit("window-migrated", { window });
  }

  #dispose(): void {
    if (this.#disposed) return;
    this.#extensions[Symbol.dispose]();
    this.#disposed = true;
    this.#stopWatch();
    this.#stopTheme();
    this.#resize?.disconnect();
    this.#chrome[Symbol.dispose]();
    this.#lifetime.dispose();
    this.#viewer[Symbol.dispose]();
    this.#emitter.close();
    this.#root.remove();
    this.#atoms[Symbol.dispose]();
  }

  #makeHandle(): PdfReader {
    return {
      kind: this.#options.kind,
      root: this.#root,
      container: this.#chrome.scroller,
      state: this.#atoms.state,
      document: this.#atoms.document,
      whenReady: () => this.#lifetime.whenReady(),
      settled: () => this.#lifetime.settled(),
      pageAt: (pageIndex) =>
        this.#disposed ? null : this.#pages.page(pageIndex),
      renderedPages: () => (this.#disposed ? [] : this.#pages.rendered()),
      whenRendered: (pageIndex) => this.#lifetime.whenRendered(pageIndex),
      navigate: (target) =>
        this.#disposed
          ? Promise.resolve("no-document")
          : this.#navigation.navigate(target),
      set: (intent) => this.#set(intent),
      command: (command) => this.#command(command),
      redraw: (pageIndex) => this.#redraw(pageIndex),
      slot: (name) => this.#chrome.slots[name],
      position: () => {
        if (this.#disposed || !this.#lifetime.hadReady) return null;
        const { pageIndex } = this.#atoms.state.get();
        return { pageIndex, subpath: `#page=${pageIndex + 1}` };
      },
      focus: () => {
        if (!this.#disposed) this.#chrome.scroller.focus();
      },
      windowMigrated: () => this.#windowMigrated(),
      on: (event, listener) => this.#emitter.on(event, listener),
      [Symbol.dispose]: () => this.#dispose(),
    };
  }
}

export function mountReader<H>(
  element: HTMLElement,
  options: MountOptions<H>,
): PdfReader {
  return new Reader(element, options).handle;
}
