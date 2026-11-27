import type {
  DocumentCitations,
  FormattedOccurrence,
} from "#obsidian/citation-text/present.ts";
import type { NavigationPane } from "#obsidian/citekey-navigation/index.ts";
import { Effect, Layer } from "effect";
import type { MarkdownPostProcessorContext, MarkdownView } from "obsidian";
import { MarkdownRenderChild } from "obsidian";
import { createRoot } from "react-dom/client";

import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import type { PluginHostShape } from "@zotlit/obsidian-kit/plugin-host.ts";
import {
  rerenderReadingViewsIn,
  retireReadingSurface,
} from "@zotlit/obsidian-kit/reading-surface.ts";
import {
  isDraftMarkdown,
  markdownViewOf,
  sectionRange,
} from "@zotlit/obsidian-kit/reading-view.ts";
import type { SectionRange } from "@zotlit/obsidian-kit/reading-view.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { parseAnnotationOpenUri } from "@zotlit/zotero-types/uri";
import type { AnnotationOpenUriOptions } from "@zotlit/zotero-types/uri";

import type { AnnotationHoverRequest } from "./service.ts";
import { AnnotationPopover } from "./service.ts";

import { showCitation } from "#obsidian/citation-text/present.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import {
  CitekeyEditor,
  citekeyTreatment,
} from "#obsidian/citekey-editor/service.ts";
import "./style.css";

const LINK_SELECTOR = 'a.external-link[href^="zotero://open/"]';

const CITATION_CLASS = "zt-annotation-citation";

export interface AnnotationLinkReadingDeps {
  host: Pick<PluginHostShape, "registerMarkdownPostProcessor">;
  markdownViews: () => readonly MarkdownView[];
  show: (request: AnnotationHoverRequest) => void;
  citations: (
    path: string,
  ) => Pick<Held<DocumentCitations>, "value" | "status"> | null;
  openItem: (indexedKey: string, pane: NavigationPane) => void;
}

interface RenderedLink {
  anchor: HTMLAnchorElement;
  link: AnnotationOpenUriOptions;
  citation?: boolean;
}

interface HeldSection {
  path: string;
  rewrite: () => void;
}

export class AnnotationLinkReadingCore implements Disposable {
  readonly #deps;
  readonly #sections = new Map<MarkdownRenderChild, HeldSection>();
  #disposed = false;

  constructor(deps: AnnotationLinkReadingDeps) {
    this.#deps = deps;
    deps.host.registerMarkdownPostProcessor((el, ctx) =>
      this.#process(el, ctx),
    );
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    for (const section of this.#sections.keys()) section.unload();
  }

  refresh(path?: string): void {
    for (const section of this.#sections.values()) {
      if (path === undefined || section.path === path) section.rewrite();
    }
  }

  #process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (this.#disposed || isDraftMarkdown(el)) return;
    const links: RenderedLink[] = [];
    for (const anchor of el.querySelectorAll<HTMLAnchorElement>(
      LINK_SELECTOR,
    )) {
      const link = parseAnnotationOpenUri(anchor.getAttribute("href") ?? "");
      if (link !== null) links.push({ anchor, link });
    }
    if (links.length === 0) return;
    const rewrite = () => {
      const held = this.#deps.citations(ctx.sourcePath);
      if (held !== null)
        this.#showCitations(links, held, sectionRange(ctx, el));
    };
    const section = this.#hold(el, ctx, rewrite);
    for (const rendered of links) {
      section.registerDomEvent(rendered.anchor, "mouseover", (event) => {
        this.#hoverAt(event, rendered, ctx.sourcePath);
      });
    }
    rewrite();
  }

  #showCitations(
    links: readonly RenderedLink[],
    { value, status }: Pick<Held<DocumentCitations>, "value" | "status">,
    range: SectionRange | null,
  ): void {
    const occurrences = annotationOccurrences(value, range);
    let next = 0;
    for (const rendered of links) {
      if (!rendered.citation && rendered.anchor.hasChildNodes()) continue;
      const index = occurrences.findIndex(
        ({ link }, at) => at >= next && sameAnnotation(link, rendered.link),
      );
      if (index === -1) {
        if (rendered.citation && status === "fresh") {
          createRoot(rendered.anchor).unmount();
          rendered.anchor.classList.remove(themeHook.citation, CITATION_CLASS);
          rendered.citation = false;
        }
        continue;
      }
      next = index + 1;
      showCitation(rendered.anchor, occurrences[index]!.occurrence, "suppress");
      rendered.anchor.classList.add(themeHook.citation, CITATION_CLASS);
      rendered.citation = true;
    }
  }

  #hold(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    rewrite: () => void,
  ): MarkdownRenderChild {
    const section = new MarkdownRenderChild(el);
    section.register(() => this.#sections.delete(section));
    this.#sections.set(section, { path: ctx.sourcePath, rewrite });
    ctx.addChild(section);
    return section;
  }

  #hoverAt(
    event: MouseEvent,
    { anchor, link }: RenderedLink,
    sourcePath: string,
  ): void {
    const related = event.relatedTarget as Node | null;
    if (related?.instanceOf(Node) && anchor.contains(related)) return;
    const hoverParent = markdownViewOf(this.#deps.markdownViews(), anchor);
    if (hoverParent === null) return;
    this.#deps.show({
      event,
      hoverParent,
      targetEl: anchor,
      sourcePath,
      link,
      open: this.#deps.openItem,
    });
  }
}

interface AnnotationOccurrence {
  link: AnnotationOpenUriOptions;
  occurrence: FormattedOccurrence;
}

function annotationOccurrences(
  citations: DocumentCitations,
  range: SectionRange | null,
): AnnotationOccurrence[] {
  const found: AnnotationOccurrence[] = [];
  for (const [source, occurrences] of citations.formatted) {
    if (!source.startsWith("[](") || !source.endsWith(")")) continue;
    const link = parseAnnotationOpenUri(source.slice(3, -1));
    if (link === null) continue;
    for (const occurrence of occurrences) {
      if (
        range === null ||
        (occurrence.start >= range.from && occurrence.start < range.to)
      )
        found.push({ link, occurrence });
    }
  }
  return found.sort((a, b) => a.occurrence.start - b.occurrence.start);
}

function sameAnnotation(
  a: AnnotationOpenUriOptions,
  b: AnnotationOpenUriOptions,
): boolean {
  return (
    a.annotationKey === b.annotationKey &&
    a.attachmentKey === b.attachmentKey &&
    a.groupID === b.groupID
  );
}

export const layerAnnotationLinkReading = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const popover = yield* AnnotationPopover;
    const workspace = yield* Workspace;
    const settings = yield* PluginSettings;
    const citationText = yield* CitationText;
    const editor = yield* CitekeyEditor;
    const bridge = yield* scopedBridge;
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    let showCitations = citekeyTreatment(
      yield* settings.current,
    ).annotationCitations;
    const core = yield* Effect.acquireDisposable(
      Effect.sync(
        () =>
          new AnnotationLinkReadingCore({
            host,
            markdownViews: () => bridge.runSync(workspace.markdownViews),
            show: (request) => bridge.runAndForget(popover.show(request)),
            citations: (path) =>
              showCitations ? run(citationText.peek(path)) : null,
            openItem: (indexedKey, pane) =>
              bridge.runAndForget(editor.openIndexedKey(indexedKey, pane)),
          }),
      ),
    );
    yield* forkEach(settings.changes, (next) => {
      const wanted = citekeyTreatment(next).annotationCitations;
      if (wanted === showCitations) return Effect.void;
      showCitations = wanted;
      return rerenderReadingViewsIn(workspace);
    });
    yield* forkEach(citationText.events, (event) =>
      Effect.sync(() => {
        if (event.type === "changed") core.refresh(event.path);
        else if (event.type === "invalidated") core.refresh();
      }),
    );
    yield* retireReadingSurface(workspace, () => {
      showCitations = false;
    });
  }),
);
