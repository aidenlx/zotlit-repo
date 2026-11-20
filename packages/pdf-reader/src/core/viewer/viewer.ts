import type { ReaderHost } from "#/core/host.ts";
import type { PageTheme } from "#/core/theme/theme.ts";
import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from "#/pdfjs.ts";

import { AnnotationEditorType } from "@zotlit/pdfjs/lib";
import {
  EventBus,
  LinkTarget,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  RenderingStates,
} from "@zotlit/pdfjs/viewer";

export interface PageView {
  readonly id: number;
  readonly div: HTMLDivElement;
  readonly viewport: PageViewport;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly rotation: number;
  readonly textLayer: { readonly div: HTMLDivElement } | null;
  readonly renderingState: number;
  readonly pdfPage: PDFPageProxy | null;
  readonly renderingId: string;
  readonly _textHighlighter: {
    readonly textDivs?: readonly HTMLElement[];
    readonly textContentItemsStr?: readonly string[] | null;
  };
  pageBackground: string | null;
  pageInvert: boolean;
  reset(): void;
}

export interface PageEvent {
  readonly source: unknown;
  readonly pageNumber: number;
  readonly cssTransform?: boolean;
  readonly isDetailView?: boolean;
}

export interface ScaleEvent {
  readonly scale: number;
  readonly presetValue?: string;
}

export interface ViewArea {
  readonly location: {
    readonly pageNumber: number;
    readonly left: number;
    readonly top: number;
  };
}

export type Destination = readonly unknown[];

export interface ReaderViewer extends Disposable {
  readonly pdfViewer: PDFViewer;
  readonly eventBus: EventBus;
  readonly linkService: PDFLinkService;
  readonly signal: AbortSignal;
  on<E>(event: string, listener: (event: E) => void): void;
  open(proxy: PDFDocumentProxy | null): void;
  pageView(pageIndex: number): PageView | null;
  pageCount(): number;
  visiblePages(): readonly PageView[];
  refreshLocation(): void;
  renderView(view: PageView): void;
  paint(theme: PageTheme): void;
  scrollTo(
    pageIndex: number,
    destination: Destination,
    options?: { readonly allowNegativeOffset?: boolean },
  ): void;
}

const MAX_CANVAS_PIXELS = 16_777_216;
const EXTERNAL_LINK_REL = "noopener noreferrer nofollow";

export const IMAGE_RESOURCES = "data:,";

function readerL10n(t: ReaderHost["t"]) {
  const label = (element: Element) => {
    if (element.getAttribute("data-l10n-id") !== "pdfjs-page-landmark") return;
    const args = JSON.parse(element.getAttribute("data-l10n-args") ?? "{}") as {
      readonly page?: number;
    };
    element.setAttribute(
      "aria-label",
      t("pdf_reader_page", { page: args.page ?? "" }),
    );
  };
  return {
    getLanguage: () => "en",
    getDirection: () => "ltr",
    get: async () => "",
    translate: async (element: Element) => {
      label(element);
      for (const child of element.querySelectorAll("[data-l10n-id]")) {
        label(child);
      }
    },
    translateOnce: async () => {},
    destroy: async () => {},
    pause: () => {},
    resume: () => {},
  };
}

export function isFinished(view: PageView): boolean {
  return view.renderingState === RenderingStates.FINISHED;
}

export function isPainted(view: PageView): boolean {
  const text = view.textLayer?.div;
  return isFinished(view) && text?.parentNode === view.div && !text.hidden;
}

export function hasStarted(view: PageView): boolean {
  return view.renderingState !== RenderingStates.INITIAL;
}

export function createViewer(options: {
  readonly container: HTMLDivElement;
  readonly viewer: HTMLDivElement;
  readonly removePageBorders: boolean;
  readonly t: ReaderHost["t"];
}): ReaderViewer {
  const lifetime = new AbortController();
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({
    eventBus,
    externalLinkTarget: LinkTarget.BLANK,
    externalLinkRel: EXTERNAL_LINK_REL,
  });
  const findController = new PDFFindController({ linkService, eventBus });
  const viewerOptions: ConstructorParameters<typeof PDFViewer>[0] & {
    readonly abortSignal: AbortSignal;
  } = {
    container: options.container,
    viewer: options.viewer,
    eventBus,
    linkService,
    findController,
    imageResourcesPath: IMAGE_RESOURCES,
    l10n: readerL10n(options.t) as unknown as NonNullable<PDFViewer["l10n"]>,
    annotationEditorMode: AnnotationEditorType.DISABLE,
    removePageBorders: options.removePageBorders,
    maxCanvasPixels: MAX_CANVAS_PIXELS,
    abortSignal: lifetime.signal,
  };
  const pdfViewer = new PDFViewer(viewerOptions);
  linkService.setViewer(pdfViewer);
  const pageView = (pageIndex: number): PageView | null =>
    (pdfViewer.getPageView(pageIndex) as PageView | undefined) ?? null;
  return {
    pdfViewer,
    eventBus,
    linkService,
    signal: lifetime.signal,
    on: (event, listener) => {
      eventBus.on(event, listener, { signal: lifetime.signal });
    },
    open: (proxy) => {
      pdfViewer.setDocument(proxy);
      linkService.setDocument(proxy);
    },
    pageView,
    pageCount: () => pdfViewer.pagesCount,
    visiblePages: () => {
      const visible = pdfViewer._getVisiblePages() as {
        readonly views: readonly { readonly view: PageView }[];
      };
      return visible.views.map(({ view }) => view);
    },
    refreshLocation: () => {
      const { first } = pdfViewer._getVisiblePages() as {
        readonly first?: unknown;
      };
      if (first) pdfViewer._updateLocation(first);
    },
    renderView: (view) => {
      pdfViewer.renderingQueue?.renderView(view as never);
    },
    paint: (theme) => {
      pdfViewer.pageBackground = theme.background;
      pdfViewer.pageInvert = theme.invert;
      for (let index = 0; index < pdfViewer.pagesCount; index++) {
        const view = pageView(index)!;
        view.pageBackground = theme.background;
        view.pageInvert = theme.invert;
      }
    },
    scrollTo: (pageIndex, destination, scrollOptions = {}) => {
      pdfViewer.scrollPageIntoView({
        pageNumber: pageIndex + 1,
        destArray: destination as unknown[],
        allowNegativeOffset: scrollOptions.allowNegativeOffset ?? false,
      });
    },
    [Symbol.dispose]: () => {
      if (lifetime.signal.aborted) return;
      pdfViewer.setDocument(null);
      linkService.setDocument(null);
      lifetime.abort();
    },
  };
}
