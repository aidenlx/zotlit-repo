import type {
  DocumentLifetime,
  Held,
  Queued,
} from "#/core/document/lifetime.ts";
import type { Emitter } from "#/core/extensions/events.ts";
import type { ReaderHost } from "#/core/host.ts";
import type { ReaderAtoms } from "#/core/state/atoms.ts";
import type { HighlightTarget, Painted } from "#/core/subpath/apply.ts";
import type { SelectionLinks } from "#/core/subpath/legacy-selection.ts";
import type { Subpath } from "#/core/subpath/parse.ts";
import type {
  NavigateOutcome,
  NavigationTarget,
  PageChangeCause,
  ReaderPage,
  ReaderState,
  ReaderZoom,
  SurfaceKind,
} from "#/core/types.ts";
import type { PageRegistry } from "#/core/viewer/pages.ts";
import type { ReaderViewer } from "#/core/viewer/viewer.ts";

import { SpreadMode } from "@zotlit/pdfjs/viewer";

import { readPosition } from "#/core/persist/position.ts";
import { intended, turned } from "#/core/state/transitions.ts";
import { clampZoom } from "#/core/state/zoom.ts";
import {
  highlightOf,
  pageDestination,
  paintAnnotation,
  paintText,
  revealIn,
  viewerHash,
} from "#/core/subpath/apply.ts";
import { parseSubpath } from "#/core/subpath/parse.ts";
import { Motion } from "#/core/viewer/motion.ts";
import { isPainted } from "#/core/viewer/viewer.ts";

const SPREADS: Readonly<Record<ReaderState["spread"], number>> = {
  none: SpreadMode.NONE,
  odd: SpreadMode.ODD,
  even: SpreadMode.EVEN,
};

interface Spot {
  readonly pageIndex: number;
  readonly left: number;
  readonly top: number;
}

export interface Kept extends Spot {
  readonly zoom: ReaderZoom;
}

interface Highlight {
  readonly target: HighlightTarget;
  readonly cause: PageChangeCause;
  readonly links: SelectionLinks | null;
  painted: Painted | null;
  revealed: boolean;
}

interface ResolvedDestination {
  readonly explicit: readonly unknown[];
  readonly pageIndex: number;
}

interface NavigationOptions {
  readonly kind: SurfaceKind;
  readonly host: ReaderHost;
  readonly atoms: ReaderAtoms;
  readonly emitter: Emitter;
  readonly viewer: ReaderViewer;
  readonly pages: PageRegistry;
  readonly scroller: HTMLElement;
  readonly mount: Subpath | null;
  readonly lifetime: DocumentLifetime<Kept>;
}

export class Navigation {
  readonly #options: NavigationOptions;
  readonly #motion: Motion;
  #shown = false;
  #initialPending = false;
  #navigation = 0;
  #navigating = 0;
  #highlight: Highlight | null = null;

  constructor(options: NavigationOptions) {
    this.#options = options;
    this.#motion = new Motion(options.scroller);
    const { pdfViewer, linkService } = options.viewer;
    const scrollPageIntoView = pdfViewer.scrollPageIntoView.bind(pdfViewer);
    pdfViewer.scrollPageIntoView = (params) =>
      this.#motion.run("navigate", () => scrollPageIntoView(params));
    const executeNamedAction = linkService.executeNamedAction.bind(linkService);
    linkService.executeNamedAction = (action) =>
      this.#motion.run("navigate", () => executeNamedAction(action));
    options.viewer.on<{ readonly pageNumber: number }>(
      "pagechanging",
      (event) => this.#pageChanged(event.pageNumber - 1),
    );
  }

  get shown(): boolean {
    return this.#shown;
  }

  navigate(target: NavigationTarget): Promise<NavigateOutcome> {
    const { atoms, lifetime } = this.#options;
    if (atoms.state.get().status === "failed") {
      return Promise.resolve("no-document");
    }
    if (!this.#shown || this.#initialPending) {
      if (this.#initialPending) this.#navigation++;
      return lifetime.queue(target);
    }
    this.#navigating++;
    return this.#apply(target, "navigate", ++this.#navigation).finally(() => {
      this.#navigating--;
      lifetime.check();
    });
  }

  begin(held: Held, kept: Kept | null): Promise<void> {
    const { kind, host, atoms, viewer, mount, lifetime } = this.#options;
    const queued = lifetime.takeQueued();
    const saved =
      kept === null && kind === "view"
        ? readPosition(host, held.lease.document.fingerprint)
        : null;
    const stored: Spot | null = kept ?? saved;
    const first = lifetime.hadReady ? null : mount;
    const spread = saved?.spread;
    if (spread) atoms.update((state) => intended(state, { spread }));
    this.#shown = true;
    this.#motion.run("restore", () => {
      viewer.pdfViewer.spreadMode = SPREADS[atoms.state.get().spread];
      this.#applyZoom(kept?.zoom ?? atoms.state.get().zoom);
    });
    this.#initialPending = true;
    return this.#applyInitial(held, { queued, mount: first, stored }).finally(
      () => {
        if (lifetime.current === held) this.#initialPending = false;
      },
    );
  }

  closing(): void {
    this.#shown = false;
    this.#initialPending = false;
    this.clearHighlight();
  }

  quiet(): boolean {
    if (this.#navigating > 0) return false;
    const visible = this.#options.viewer.visiblePages();
    const highlight = this.#highlight;
    if (
      highlight &&
      !highlight.revealed &&
      visible.some((view) => view.id - 1 === highlight.target.pageIndex)
    ) {
      return false;
    }
    return visible.every((view) => isPainted(view));
  }

  rendered(page: ReaderPage): void {
    if (this.#highlight?.target.pageIndex === page.pageIndex) {
      this.#paintHighlight(page);
    }
  }

  clearHighlight(): boolean {
    const highlight = this.#highlight;
    if (!highlight) return false;
    this.#highlight = null;
    highlight.painted?.clear();
    this.#options.lifetime.check();
    return true;
  }

  async destination(
    dest: string | readonly unknown[],
  ): Promise<ResolvedDestination | null> {
    const { lifetime } = this.#options;
    const held = lifetime.current;
    if (!held) return null;
    const { proxy } = held.headless;
    const explicit: unknown =
      typeof dest === "string"
        ? await proxy.getDestination(dest).catch(() => null)
        : dest;
    if (!Array.isArray(explicit)) return null;
    const [reference] = explicit as readonly unknown[];
    let pageIndex: number | null = null;
    if (Number.isInteger(reference)) {
      pageIndex = reference as number;
    } else if (typeof reference === "object" && reference !== null) {
      pageIndex = await proxy
        .getPageIndex(reference as Parameters<typeof proxy.getPageIndex>[0])
        .catch(() => null);
    }
    if (pageIndex === null || lifetime.current !== held) return null;
    return { explicit: explicit as readonly unknown[], pageIndex };
  }

  goToDestination(dest: string | readonly unknown[]): void {
    if (!this.#shown) return;
    void this.#options.viewer.linkService.goToDestination(dest as unknown[]);
  }

  runAction(action: string): void {
    if (this.#shown)
      this.#options.viewer.linkService.executeNamedAction(action);
  }

  set(view: {
    readonly spread?: ReaderState["spread"] | undefined;
    readonly zoom?: ReaderZoom | undefined;
  }): void {
    if (!this.#shown) return;
    const { spread, zoom } = view;
    this.#motion.run("user", () => {
      if (spread !== undefined) {
        this.#options.viewer.pdfViewer.spreadMode = SPREADS[spread];
      }
      if (zoom !== undefined) this.#applyZoom(zoom);
    });
  }

  fit(): void {
    const { zoom } = this.#options.atoms.state.get();
    if (!this.#shown || typeof zoom === "number") return;
    this.#motion.run("restore", () => this.#applyZoom(zoom));
  }

  scale(): number {
    return this.#options.viewer.pdfViewer.currentScale;
  }

  zoomBy(change: {
    readonly steps?: number;
    readonly scaleFactor?: number;
    readonly origin: readonly [number, number];
    readonly pan?: readonly [number, number];
    readonly drawingDelay?: number;
  }): void {
    const { viewer, scroller } = this.#options;
    const { pdfViewer } = viewer;
    this.#motion.run("user", () => {
      const box = scroller.getBoundingClientRect();
      const [top, left] = pdfViewer.containerTopLeft as [number, number];
      viewer.refreshLocation();
      pdfViewer.updateScale({
        steps: change.steps,
        scaleFactor: change.scaleFactor,
        origin: [
          change.origin[0] - box.left + left,
          change.origin[1] - box.top + top,
        ],
        pan: change.pan ? [...change.pan] : undefined,
        drawingDelay: change.drawingDelay,
      });
    });
  }

  pan(dx: number, dy: number): void {
    this.#motion.run("user", () =>
      this.#options.viewer.pdfViewer.panBy(dx, dy),
    );
  }

  step(direction: "next" | "previous"): boolean {
    const { pdfViewer } = this.#options.viewer;
    return (
      this.#shown &&
      this.#motion.run("user", () =>
        direction === "next" ? pdfViewer.nextPage() : pdfViewer.previousPage(),
      )
    );
  }

  kept(): Kept | null {
    if (!this.#shown) return null;
    const { viewer, atoms } = this.#options;
    viewer.refreshLocation();
    const location = viewer.pdfViewer._location;
    if (!location) return null;
    return {
      pageIndex: location.pageNumber - 1,
      left: location.left,
      top: location.top,
      zoom: atoms.state.get().zoom,
    };
  }

  #applyZoom(zoom: ReaderZoom): void {
    const { viewer, scroller } = this.#options;
    viewer.refreshLocation();
    if (typeof zoom === "number") {
      viewer.pdfViewer.currentScale = clampZoom(zoom);
    } else if (scroller.clientWidth > 0) {
      viewer.pdfViewer.currentScaleValue = zoom;
    }
  }

  #pageChanged(pageIndex: number): void {
    const { atoms, emitter, lifetime } = this.#options;
    const state = atoms.state.get();
    if (state.pageIndex === pageIndex) return;
    const cause = this.#motion.cause();
    atoms.update((current) =>
      turned(current, pageIndex, lifetime.current?.labels ?? null),
    );
    emitter.emit("page-change", {
      pageIndex,
      previous: state.pageIndex,
      cause,
    });
    lifetime.check();
  }

  async #applyInitial(
    held: Held,
    initial: {
      readonly queued: Queued | null;
      readonly mount: Subpath | null;
      readonly stored: Spot | null;
    },
  ): Promise<void> {
    const { viewer, lifetime } = this.#options;
    const { queued, mount, stored } = initial;
    if (queued) {
      queued.resolve(
        await this.#apply(queued.target, "restore", ++this.#navigation),
      );
    } else if (mount) {
      await this.#applySubpath(mount, "restore", {
        announce: false,
        navigation: ++this.#navigation,
      });
    } else if (stored) {
      this.#motion.run("restore", () =>
        viewer.scrollTo(
          stored.pageIndex,
          [null, { name: "XYZ" }, stored.left, stored.top, null],
          { allowNegativeOffset: true },
        ),
      );
    }
    while (lifetime.current === held) {
      const next = lifetime.takeQueued();
      if (!next) break;
      next.resolve(
        await this.#apply(next.target, "restore", ++this.#navigation),
      );
    }
  }

  #apply(
    target: NavigationTarget,
    cause: PageChangeCause,
    navigation: number,
  ): Promise<NavigateOutcome> {
    const { viewer, lifetime } = this.#options;
    if (typeof target === "string") {
      return this.#applySubpath(parseSubpath(target), cause, {
        announce: true,
        navigation,
      });
    }
    if ("dest" in target) {
      return this.#applyDestination(target.dest, cause, navigation);
    }
    if (!lifetime.inRange(target.pageIndex)) {
      return Promise.resolve("out-of-range");
    }
    this.#motion.run(cause, () =>
      viewer.scrollTo(target.pageIndex, [
        null,
        { name: "XYZ" },
        null,
        target.top ?? null,
        null,
      ]),
    );
    return Promise.resolve("shown");
  }

  async #applySubpath(
    subpath: Subpath,
    cause: PageChangeCause,
    options: { readonly announce: boolean; readonly navigation: number },
  ): Promise<NavigateOutcome> {
    const { viewer, emitter, lifetime } = this.#options;
    const destination = pageDestination(subpath);
    let outcome: NavigateOutcome = "shown";
    if (destination && subpath.page !== null) {
      if (!lifetime.inRange(subpath.page - 1)) return "out-of-range";
      this.clearHighlight();
      this.#motion.run(cause, () =>
        viewer.scrollTo(subpath.page! - 1, destination),
      );
      const target = highlightOf(subpath);
      if (target) this.#setHighlight(target, cause);
    } else if (subpath.dest !== null) {
      outcome = await this.#applyDestination(
        subpath.dest,
        cause,
        options.navigation,
      );
    } else {
      const hash = viewerHash(subpath);
      if (hash) this.#motion.run(cause, () => viewer.linkService.setHash(hash));
    }
    if (options.announce && outcome === "shown") {
      emitter.emit("subpath", { subpath });
    }
    return outcome;
  }

  async #applyDestination(
    name: string,
    cause: PageChangeCause,
    navigation: number,
  ): Promise<NavigateOutcome> {
    const { viewer, lifetime } = this.#options;
    const held = lifetime.current;
    if (!held) return "no-document";
    const resolved = await this.destination(name);
    if (lifetime.current !== held) return "no-document";
    if (navigation !== this.#navigation) return "superseded";
    if (!resolved || !lifetime.inRange(resolved.pageIndex)) {
      return "unknown-destination";
    }
    this.#motion.run(cause, () =>
      viewer.scrollTo(resolved.pageIndex, resolved.explicit),
    );
    return "shown";
  }

  #setHighlight(target: HighlightTarget, cause: PageChangeCause): void {
    const highlight: Highlight = {
      target,
      cause,
      links: this.#options.lifetime.current?.links ?? null,
      painted: null,
      revealed: false,
    };
    this.#highlight = highlight;
    if (target.kind === "text") {
      void (highlight.links?.load(target.pageIndex) ?? Promise.resolve()).then(
        () => {
          if (this.#highlight === highlight) {
            this.#paintIfShown(target.pageIndex);
          }
        },
      );
    }
    this.#paintIfShown(target.pageIndex);
  }

  #paintIfShown(pageIndex: number): void {
    const { pages } = this.#options;
    const page = pages.page(pageIndex);
    const view = pages.view(pageIndex);
    if (page && view && isPainted(view)) this.#paintHighlight(page);
  }

  #paintHighlight(page: ReaderPage): void {
    const highlight = this.#highlight;
    const view = this.#options.pages.view(page.pageIndex);
    if (!highlight || !view) return;
    const { target } = highlight;
    if (target.kind === "text") {
      const { links } = highlight;
      if (links && !links.loaded(target.pageIndex)) return;
      highlight.painted?.clear();
      const range = links?.forkRange(view, target.range) ?? null;
      highlight.painted = range ? paintText(view, range) : null;
      this.#reveal(highlight);
      return;
    }
    if (highlight.painted) return;
    paintAnnotation(page, view, target.id).then(
      (result) => {
        if (this.#highlight !== highlight) {
          result?.clear();
          return;
        }
        highlight.painted = result;
        this.#reveal(highlight);
      },
      (error: unknown) => {
        if (this.#highlight !== highlight) return;
        this.#options.host.report(error, { phase: "highlight" });
        this.#reveal(highlight);
      },
    );
  }

  #reveal(highlight: Highlight): void {
    if (highlight.revealed) return;
    highlight.revealed = true;
    const first = highlight.painted?.first;
    if (first) {
      this.#motion.run(highlight.cause, () =>
        revealIn(this.#options.scroller, first),
      );
    }
    this.#options.lifetime.check();
  }
}
