import type { CitationLookupObservation } from "#obsidian/citation-index/service.ts";
import type {
  CitationCoordinate,
  DocumentCitations,
  PresentedCitation,
  ShownCitation,
} from "#obsidian/citation-text/present.ts";
import type {
  CitationClickAffordance,
  CitationHover,
  CitationHoverRequest,
  HoveredWork,
  HoverPreferences,
  NavigationPane,
} from "#obsidian/citekey-navigation/index.ts";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { editorInfoField, livePreviewState } from "obsidian";

import {
  livePreviewOf,
  tokenNodes,
  visibleLineRanges,
} from "@zotlit/obsidian-kit/editor-decoration.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import type { LiteratureNoteTarget } from "@zotlit/plugin-kernel/wikilink-citation.ts";
import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";
import type { CitationLookupAnswer } from "@zotlit/zotero-reads/contract/citation-lookup.ts";

import { searchMatchHighlights, wikilinkDecorations } from "./decorate.ts";
import type { WikilinkDecoration } from "./decorate.ts";
import { scanWikilinks } from "./scan.ts";

import { EditorLookup } from "#obsidian/citation-index/editor-lookup.ts";
import {
  citationContent,
  presentedCitationEqual,
  showCitation,
} from "#obsidian/citation-text/present.ts";
import {
  clickWikilinkCitation,
  hoverWikilinkCitation,
  markCitationClick,
} from "#obsidian/citekey-navigation/index.ts";
import "./style.css";

const UNDERLINE_CLASS = "cm-underline";

export interface WikilinkEditorHandlers {
  literatureNote: (
    linkpath: string,
    sourcePath: string,
    lookup: CitationLookupAnswer | null,
  ) => LiteratureNoteTarget | null;
  observeLookup: (changed: () => void) => CitationLookupObservation;
  enabled: () => boolean;
  citationText: (path: string) => Held<DocumentCitations> | null;
  open: (citekey: string, pane: NavigationPane) => void;
  showPopover: (request: CitationHoverRequest) => void;
  hoverPreferences: () => HoverPreferences;
  popoverHover: () => boolean;
  clickIntercepted: () => boolean;
}

const renderedCitations = new WeakMap<HTMLElement, RenderedWikilinkCitation>();

interface RenderedWikilinkCitation {
  content: PresentedCitation;
  className: string;
  click: CitationClickAffordance;
  works: readonly HoveredWork[];
  shown: ShownCitation;
}

export const wikilinkDecorationsChanged = StateEffect.define<void>();

export function wikilinkEditorExtension(
  handlers: WikilinkEditorHandlers,
): Extension {
  return ViewPlugin.fromClass(
    class WikilinkEditorPlugin {
      decorations: DecorationSet = Decoration.none;
      #tree;
      readonly #view;
      readonly #lookup;
      readonly #listeners = new Map<GestureType, (event: MouseEvent) => void>();

      constructor(view: EditorView) {
        this.#view = view;
        this.#lookup = new EditorLookup(handlers.observeLookup, () => {
          view.dispatch({ effects: wikilinkDecorationsChanged.of(undefined) });
        });
        this.#tree = syntaxTree(view.state);
        this.#rebuild(view);
        this.#watchGestures();
      }

      destroy(): void {
        this.#lookup[Symbol.dispose]();
        for (const type of this.#listeners.keys()) {
          this.#remove(type);
        }
      }

      #watchGestures(): void {
        this.#watch("mouseover", handlers.popoverHover(), (event) => {
          hoverRenderedCitation(event, this.#view, handlers);
        });
        this.#watch("click", handlers.clickIntercepted(), (event) => {
          clickRenderedCitation(event, this.#view, handlers);
        });
      }

      #watch(
        type: GestureType,
        wanted: boolean,
        answer: (event: MouseEvent) => void,
      ): void {
        const installed = this.#listeners.has(type);
        if (wanted === installed) return;
        if (installed) {
          this.#remove(type);
          return;
        }
        this.#view.dom.addEventListener(type, answer, true);
        this.#listeners.set(type, answer);
      }

      #remove(type: GestureType): void {
        const installed = this.#listeners.get(type);
        if (installed === undefined) return;
        this.#view.dom.removeEventListener(type, installed, true);
        this.#listeners.delete(type);
      }

      update(update: ViewUpdate): void {
        this.#watchGestures();
        const tree = syntaxTree(update.state);
        if (
          tree.length < update.view.viewport.to ||
          update.view.composing ||
          update.view.plugin(livePreviewState)?.mousedown
        ) {
          if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes);
          }
          return;
        }
        if (
          tree !== this.#tree ||
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.focusChanged ||
          livePreviewOf(update.state) !== livePreviewOf(update.startState) ||
          update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(wikilinkDecorationsChanged)),
          ) ||
          searchHighlightsChanged(update.startState, update.state)
        ) {
          this.#tree = tree;
          this.#rebuild(update.view);
        }
      }

      #rebuild(view: EditorView): void {
        const built = buildDecorations(
          view,
          handlers,
          this.#lookup.current?.value ?? null,
        );
        this.decorations = built.decorations;
        this.#lookup.set({ indexedKeys: built.indexedKeys });
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function searchHighlightsChanged(
  before: EditorState,
  after: EditorState,
): boolean {
  const previous = before.facet(EditorView.decorations);
  const current = after.facet(EditorView.decorations);
  if (previous === current) return false;
  const oldRanges = searchMatchHighlights(previous);
  const newRanges = searchMatchHighlights(current);
  return (
    oldRanges.length !== newRanges.length ||
    oldRanges.some(
      ({ from, to }, index) =>
        from !== newRanges[index]!.from || to !== newRanges[index]!.to,
    )
  );
}

type GestureType = "mouseover" | "click";

function hoverRenderedCitation(
  event: MouseEvent,
  view: EditorView,
  handlers: WikilinkEditorHandlers,
): void {
  const citation = renderedCitationAt(event, view, handlers);
  if (citation === null) return;
  hoverWikilinkCitation(event, citation.element, citation.hover);
}

function clickRenderedCitation(
  event: MouseEvent,
  view: EditorView,
  handlers: WikilinkEditorHandlers,
): void {
  const citation = renderedCitationAt(event, view, handlers);
  if (citation === null) return;
  clickWikilinkCitation(event, {
    where: citation.hover.where,
    edit: () => placeCaret(event, view),
  });
}

function placeCaret(event: MouseEvent, view: EditorView): void {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return;
  view.dispatch({ selection: { anchor: pos } });
  view.focus();
}

function renderedCitationAt(
  event: MouseEvent,
  view: EditorView,
  handlers: WikilinkEditorHandlers,
): { element: HTMLElement; hover: CitationHover } | null {
  const target = event.target as Node | null;
  if (!target?.instanceOf(HTMLElement)) return null;
  const element = target.closest<HTMLElement>(
    `.${themeHook.literatureNoteLink}`,
  );
  const citation =
    element === null ? undefined : renderedCitations.get(element);
  if (element === null || citation === undefined) return null;

  return {
    element,
    hover: {
      works: citation.works,
      shown: citation.shown,
      where: { surface: "editor", editorMode: "live-preview" },
      open: handlers.open,
      showPopover: handlers.showPopover,
      hoverPreferences: handlers.hoverPreferences,
      hoverTarget: () => {
        const info = view.state.field(editorInfoField, false);
        return info
          ? {
              workspace: info.app.workspace,
              hoverParent: info,
              sourcePath: info.file?.path ?? "",
            }
          : null;
      },
    },
  };
}

class CitationDisplayWidget extends WidgetType {
  readonly #content;
  readonly #shown;
  readonly #className;
  readonly #works;
  readonly #click;

  constructor(
    content: PresentedCitation,
    tokenClasses: readonly string[],
    options: {
      works: readonly HoveredWork[];
      shown: ShownCitation;
      click: CitationClickAffordance;
    },
  ) {
    super();
    this.#content = content;
    this.#shown = options.shown;
    this.#works = options.works;
    this.#click = options.click;
    this.#className = [
      ...tokenClasses.map((name) => `cm-${name}`),
      UNDERLINE_CLASS,
      themeHook.citation,
      themeHook.literatureNoteLink,
    ].join(" ");
  }

  eq(other: CitationDisplayWidget): boolean {
    return (
      other.#content === this.#content &&
      other.#className === this.#className &&
      other.#click === this.#click
    );
  }

  updateDOM(element: HTMLElement): boolean {
    const rendered = renderedCitations.get(element);
    if (
      rendered === undefined ||
      !presentedCitationEqual(rendered.content, this.#content) ||
      rendered.className !== this.#className ||
      rendered.click !== this.#click
    ) {
      return false;
    }
    renderedCitations.set(element, {
      content: this.#content,
      className: this.#className,
      click: this.#click,
      works: this.#works,
      shown: this.#shown,
    });
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = view.dom.win.createSpan();
    element.className = this.#className;
    element.tabIndex = -1;
    element.draggable = true;
    markCitationClick(element, this.#click);
    showCitation(element, this.#content, "suppress");
    renderedCitations.set(element, {
      content: this.#content,
      className: this.#className,
      click: this.#click,
      works: this.#works,
      shown: this.#shown,
    });
    return element;
  }
}

function buildDecorations(
  view: EditorView,
  handlers: WikilinkEditorHandlers,
  lookup: CitationLookupAnswer | null,
): { decorations: DecorationSet; indexedKeys: readonly string[] } {
  const { state } = view;
  const file = state.field(editorInfoField, false)?.file ?? null;
  const sourcePath = file?.path ?? "";
  const indexedKeys = new Set<string>();
  const citations = file === null ? null : handlers.citationText(file.path);
  const context = {
    literatureNote: (linkpath: string) => {
      const note = handlers.literatureNote(
        linkpath,
        sourcePath,
        citations?.value.lookup ?? lookup,
      );
      if (note) indexedKeys.add(note.indexedKey);
      return note;
    },
    enabled: handlers.enabled(),
    selection: view.hasFocus ? state.selection.ranges : [],
    searchHighlights: searchMatchHighlights(
      state.facet(EditorView.decorations),
    ),
    textBetween: (from: number, to: number) => state.doc.sliceString(from, to),
  };

  const spans = [];
  for (const range of visibleLineRanges(view)) {
    spans.push(...scanWikilinks(tokenNodes(state, range)));
  }
  const decorations: WikilinkDecoration[] = livePreviewOf(state)
    ? wikilinkDecorations(spans, context)
    : [];
  if (decorations.length === 0) {
    return { decorations: Decoration.none, indexedKeys: [...indexedKeys] };
  }

  const click: CitationClickAffordance = handlers.clickIntercepted()
    ? "edit"
    : "open";
  const replacements =
    citations === null
      ? []
      : decorations.flatMap((candidate) => {
          const decoration = replacement(candidate, citations.value, click);
          return decoration === null
            ? []
            : [{ from: candidate.from, to: candidate.to, decoration }];
        });
  replacements.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, decoration } of replacements) {
    builder.add(from, to, decoration);
  }
  return { decorations: builder.finish(), indexedKeys: [...indexedKeys] };
}

function replacement(
  decoration: WikilinkDecoration,
  citations: DocumentCitations,
  click: CitationClickAffordance,
): Decoration | null {
  const at: CitationCoordinate = { kind: "offset", start: decoration.start };
  const formatted = citationContent(decoration.citation, citations, at);
  if (formatted === null) return null;
  return Decoration.replace({
    widget: new CitationDisplayWidget(formatted, decoration.tokenClasses, {
      works: citedWorks(decoration),
      shown: { citation: decoration.citation, at },
      click,
    }),
  });
}

function citedWorks({ citation }: WikilinkDecoration): HoveredWork[] {
  return citation.keys.map(({ citekey }, at) => ({
    citekey,
    indexedKey: citation.works[at],
  }));
}
