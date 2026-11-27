import type { AnnotationHoverRequest } from "#obsidian/annotation-popover/service.ts";
import type {
  DocumentCitations,
  PresentedCitation,
} from "#obsidian/citation-text/present.ts";
import type { NavigationPane } from "#obsidian/citekey-navigation/index.ts";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { RangeSetBuilder } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { Effect } from "effect";
import { editorInfoField, Keymap, livePreviewState } from "obsidian";

import {
  livePreviewOf,
  overlapsSelection,
  tokenNodes,
  visibleLineRanges,
} from "@zotlit/obsidian-kit/editor-decoration.ts";
import type {
  DocRange,
  TokenNode,
} from "@zotlit/obsidian-kit/editor-decoration.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";
import { parseAnnotationOpenUri } from "@zotlit/zotero-types/uri";
import type { AnnotationOpenUriOptions } from "@zotlit/zotero-types/uri";

import { citekeyDecorationsChanged } from "./extension.ts";

import {
  citationContent,
  citationElement,
  presentedCitationEqual,
} from "#obsidian/citation-text/present.ts";

export type DurableAnnotationLink = AnnotationOpenUriOptions;

export interface AnnotationLinkHoverHandlers {
  showAnnotation: (request: AnnotationHoverRequest) => void;
  showCitations: () => boolean;
  citationText: (path: string) => Held<DocumentCitations> | null;
  openItem: (indexedKey: string, pane: NavigationPane) => void;
}

const LINK_SELECTOR = ".cm-link, .cm-url";

const LINK_CLASS = "zt-annotation-link";

const CITATION_CLASS = "zt-annotation-citation";

const linkMark = Decoration.mark({ class: LINK_CLASS });

export function annotationLinkHoverExtension(
  handlers: AnnotationLinkHoverHandlers,
): Extension {
  return [
    annotationCitationWidgets(handlers),
    annotationLinkMarks,
    EditorView.outerDecorations.of(
      (view) =>
        view.plugin(annotationLinkMarks)?.decorations ?? Decoration.none,
    ),
    EditorView.domEventHandlers({
      mouseover(event, view) {
        hoverAt(event, view, handlers);
        return false;
      },
    }),
  ];
}

const annotationLinkMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = markLinks(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = markLinks(update.view);
      }
    }
  },
);

function markLinks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of visibleLineRanges(view)) {
    for (const { from, to } of annotationLinksIn(view.state, range)) {
      builder.add(from, to, linkMark);
    }
  }
  return builder.finish();
}

function annotationCitationWidgets(handlers: AnnotationLinkHoverHandlers) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = citationWidgets(view, handlers);
      }

      update(update: ViewUpdate): void {
        const tree = syntaxTree(update.state);
        if (
          tree.length < update.view.viewport.to ||
          update.view.composing ||
          update.view.plugin(livePreviewState)?.mousedown
        ) {
          if (update.docChanged)
            this.decorations = this.decorations.map(update.changes);
          return;
        }
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.focusChanged ||
          tree !== syntaxTree(update.startState) ||
          livePreviewOf(update.state) !== livePreviewOf(update.startState) ||
          update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(citekeyDecorationsChanged)),
          )
        ) {
          this.decorations = citationWidgets(update.view, handlers);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
        ),
    },
  );
}

function citationWidgets(
  view: EditorView,
  handlers: AnnotationLinkHoverHandlers,
): DecorationSet {
  const held = heldCitations(view, handlers);
  if (held === null) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const selection = view.hasFocus ? view.state.selection.ranges : [];
  for (const range of visibleLineRanges(view)) {
    for (const span of annotationLinksIn(view.state, range)) {
      if (overlapsSelection(selection, span.from, span.to)) continue;
      const content = annotationCitationContent(view.state, span, held);
      if (content === null) continue;
      builder.add(
        span.from,
        span.to,
        Decoration.replace({
          widget: new AnnotationCitationWidget(span.url, content),
        }),
      );
    }
  }
  return builder.finish();
}

function heldCitations(
  view: EditorView,
  handlers: AnnotationLinkHoverHandlers,
): DocumentCitations | null {
  if (!handlers.showCitations() || !livePreviewOf(view.state)) return null;
  const file = view.state.field(editorInfoField, false)?.file;
  if (!file) return null;
  return handlers.citationText(file.path)?.value ?? null;
}

function annotationCitationContent(
  state: EditorState,
  span: AnnotationLinkSpan,
  citations: DocumentCitations,
): PresentedCitation | null {
  if (!span.empty) return null;
  return citationContent(
    { source: state.sliceDoc(span.from, span.to), keys: [] },
    citations,
    { kind: "offset", start: span.from },
  );
}

class AnnotationCitationWidget extends WidgetType {
  readonly #url;
  readonly #content;

  constructor(url: string, content: PresentedCitation) {
    super();
    this.#url = url;
    this.#content = content;
  }

  eq(other: AnnotationCitationWidget): boolean {
    return (
      other.#url === this.#url &&
      presentedCitationEqual(other.#content, this.#content)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = citationElement(view.dom.ownerDocument, this.#content, [
      themeHook.citationKey,
      LINK_CLASS,
      CITATION_CLASS,
    ]);
    const follow = (event: MouseEvent, pane: NavigationPane): void => {
      event.preventDefault();
      // oxlint-disable-next-line no-restricted-globals -- File Link Capture patches this global, which every link Obsidian follows reaches.
      window.open(this.#url, typeof pane === "string" ? pane : undefined);
    };
    element.addEventListener("click", (event) => {
      if (event.button === 0) follow(event, Keymap.isModEvent(event));
    });
    element.addEventListener("auxclick", (event) => {
      if (event.button === 1) follow(event, "tab");
    });
    return element;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "mouseover";
  }
}

function hoverAt(
  event: MouseEvent,
  view: EditorView,
  handlers: AnnotationLinkHoverHandlers,
): void {
  const targetEl = linkElementAt(event);
  if (targetEl === null) return;
  const span = annotationLinkSpanAt(view.state, view.posAtDOM(targetEl));
  if (span === null) return;
  const { link } = span;

  const editorMode = view.dom.closest(".is-live-preview")
    ? "live-preview"
    : "source";
  const info = view.state.field(editorInfoField, false);
  if (!info) return;
  Effect.runSyncWith(logServices)(
    Effect.logTrace("Annotation link shows its annotation").pipe(
      Effect.annotateLogs({
        annotationKey: link.annotationKey,
        editorMode,
      }),
      withLogCategory("citekey-editor"),
    ),
  );
  handlers.showAnnotation({
    event,
    hoverParent: info,
    targetEl,
    sourcePath: info.file?.path ?? "",
    link,
    open: handlers.openItem,
  });
}

function linkElementAt(event: MouseEvent): HTMLElement | null {
  const target = event.target as Node | null;
  const relatedTarget = event.relatedTarget as Node | null;
  if (!target?.instanceOf(HTMLElement)) return null;
  if (
    target.closest(LINK_SELECTOR) === null &&
    target.closest(`.${CITATION_CLASS}`) === null
  )
    return null;
  const targetEl = target.closest<HTMLElement>(`.${LINK_CLASS}`);
  if (targetEl === null) return null;
  if (relatedTarget?.instanceOf(Node) && targetEl.contains(relatedTarget)) {
    return null;
  }
  return targetEl;
}

export function annotationLinkAtPos(
  state: EditorState,
  pos: number,
): DurableAnnotationLink | null {
  return annotationLinkSpanAt(state, pos)?.link ?? null;
}

function annotationLinkSpanAt(
  state: EditorState,
  pos: number,
): AnnotationLinkSpan | null {
  const line = state.doc.lineAt(pos);
  return (
    annotationLinksIn(state, line).findLast(
      ({ from, to }) => from <= pos && pos <= to,
    ) ?? null
  );
}

interface AnnotationLinkSpan extends DocRange {
  link: DurableAnnotationLink;
  url: string;
  empty: boolean;
}

function annotationLinksIn(
  state: EditorState,
  range: DocRange,
): AnnotationLinkSpan[] {
  return markdownLinks(tokenNodes(state, range)).flatMap(
    ({ from, to, url, empty }) => {
      const link = parseAnnotationOpenUri(url);
      return link === null ? [] : [{ from, to, link, url, empty }];
    },
  );
}

const TOKEN_LINK = "link";
const TOKEN_LINK_BRACKET = "formatting-link";
const TOKEN_URL_PAREN = "formatting-link-string";
const TOKEN_URL = "url";

function markdownLinks(
  nodes: readonly TokenNode[],
): { from: number; to: number; url: string; empty: boolean }[] {
  const links: { from: number; to: number; url: string; empty: boolean }[] = [];
  let run: {
    from: number;
    at: number;
    phase: "text" | "closed" | "url";
    url: string;
    empty: boolean;
  } | null = null;

  for (const { from, to, classes, text } of nodes) {
    const bracket =
      classes.includes(TOKEN_LINK_BRACKET) && classes.includes(TOKEN_LINK);
    const paren = classes.includes(TOKEN_URL_PAREN);

    if (run !== null && from === run.at) {
      run.at = to;
      if (run.phase === "text") {
        if (bracket && text === "]") run.phase = "closed";
        else if (!classes.includes(TOKEN_LINK)) run = null;
        continue;
      }
      if (run.phase === "closed") {
        if (paren && text === "(") {
          run.phase = "url";
          continue;
        }
      } else if (paren && text === ")") {
        links.push({ from: run.from, to, url: run.url, empty: run.empty });
        run = null;
        continue;
      } else if (classes.includes(TOKEN_URL)) {
        run.url += text;
        continue;
      }
    }
    run =
      bracket && (text === "[" || text === "[]")
        ? {
            from,
            at: to,
            phase: text === "[" ? "text" : "closed",
            url: "",
            empty: text === "[]",
          }
        : null;
  }
  return links;
}
