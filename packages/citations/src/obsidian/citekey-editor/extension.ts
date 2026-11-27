import type { CitationLookupObservation } from "#obsidian/citation-index/service.ts";
import type {
  CitationCoordinate,
  CitationKeyState,
  DocumentCitations,
  PresentedCitation,
  ShownCitation,
} from "#obsidian/citation-text/present.ts";
import type {
  CitationHoverRequest,
  CitationNavigation,
  CitedWork,
  EditorMode,
  HoverPreferences,
  NavigationPane,
} from "#obsidian/citekey-navigation/index.ts";
import {
  lineClassNodeProp,
  syntaxTree,
  tokenClassNodeProp,
} from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { Prec, RangeSetBuilder, StateEffect } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { Effect } from "effect";
import type { Workspace } from "obsidian";
import { editorInfoField, livePreviewState } from "obsidian";

import {
  livePreviewOf,
  overlapsSelection,
} from "@zotlit/obsidian-kit/editor-decoration.ts";
import {
  logServices,
  withLogCategory,
  logLevelEnabled,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";
import { heldResolution } from "@zotlit/zotero-reads/contract/citation-lookup.ts";
import type {
  CitationLookupAnswer,
  CitekeyResolution,
} from "@zotlit/zotero-reads/contract/citation-lookup.ts";

import type { CitationRange } from "./decorate.ts";
import {
  citationRanges,
  citekeyMarks,
  FOOTNOTE_WIDGET_CLASS,
  isExcludedTokenClass,
  isFootnoteTokenClass,
  marksOutside,
  stateCitekeyMarks,
} from "./decorate.ts";

import { EditorLookup } from "#obsidian/citation-index/editor-lookup.ts";
import {
  citationContent,
  citationElement,
  citationKeyStates,
  citationState,
  citationStateHooks,
  citedWorks,
  citekeyState,
  literalKeyStateOf,
  presentedCitationEqual,
} from "#obsidian/citation-text/present.ts";
import {
  attachCitationNavigation,
  attachClosedCitationGestures,
  citationClickIntent,
  citationHoverIntent,
  hoverGesture,
  markCitationClick,
  mouseGesture,
  navigationIntent,
  triggerCitekeyHover,
} from "#obsidian/citekey-navigation/index.ts";
import "./style.css";

export type OpenCitekey = (citekey: string, pane: NavigationPane) => void;

export type ResolveCitekey = (citekey: string) => CitekeyResolution | null;

export interface CitekeyEditorHandlers {
  open: OpenCitekey;
  workspace: Pick<Workspace, "trigger">;
  showPopover: (request: CitationHoverRequest) => void;
  hoverPreferences: () => HoverPreferences;
  hoverNotePath: (
    citekey: string,
    lookup?: CitationLookupAnswer | null,
  ) => string | null;
  observeLookup: (changed: () => void) => CitationLookupObservation;
  navigationEnabled: () => boolean;
  showFormatted: () => boolean;
  citationText: (path: string) => Held<DocumentCitations> | null;
}

export const citekeyDecorationsChanged = StateEffect.define<void>();

const MARK_CLASS = `cm-underline ${themeHook.citationKey}`;

function markClass(state: CitationKeyState): string {
  return [MARK_CLASS, ...citationStateHooks(citationState([state]))].join(" ");
}

const EDIT_ATTRIBUTES = { "data-zt-click": "edit" };

const CITEKEY_MARKS = {
  open: markDecorations(),
  edit: markDecorations(EDIT_ATTRIBUTES),
} as const;

function markDecorations(
  attributes?: Record<string, string>,
): Record<CitationKeyState, Decoration> {
  return {
    pending: Decoration.mark({ class: markClass("pending"), attributes }),
    resolved: Decoration.mark({ class: markClass("resolved"), attributes }),
    missing: Decoration.mark({ class: markClass("missing"), attributes }),
    ambiguous: Decoration.mark({ class: markClass("ambiguous"), attributes }),
  };
}

interface CitekeyDecorations {
  marks: DecorationSet;
  widgets: DecorationSet;
  citekeys: readonly string[];
}

export function citekeyEditorExtension(
  handlers: CitekeyEditorHandlers,
): Extension {
  return ViewPlugin.fromClass(
    class CitekeyEditorPlugin {
      decorations: DecorationSet = Decoration.none;
      widgets: DecorationSet = Decoration.none;
      #editClick: { from: number; x: number; y: number } | null = null;
      readonly #lookup;

      constructor(view: EditorView) {
        this.#lookup = new EditorLookup(handlers.observeLookup, () => {
          view.dispatch({ effects: citekeyDecorationsChanged.of(undefined) });
        });
        this.#rebuild(view);
      }

      destroy(): void {
        this.#lookup[Symbol.dispose]();
      }

      readonly #resolve: ResolveCitekey = (citekey) =>
        heldResolution(this.#lookup.current?.value ?? null, citekey);

      update(update: ViewUpdate): void {
        if (update.docChanged) this.#editClick = null;
        const tree = syntaxTree(update.state);
        if (
          tree.length < update.view.viewport.to ||
          update.view.composing ||
          update.view.plugin(livePreviewState)?.mousedown
        ) {
          if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes);
            this.widgets = this.widgets.map(update.changes);
          }
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
          this.#rebuild(update.view);
        }
      }

      startEditClick(event: MouseEvent, view: EditorView): void {
        this.#editClick = null;
        if (
          handlers.navigationEnabled() ||
          event.button !== 0 ||
          event.shiftKey ||
          event.altKey ||
          citationClickIntent(
            mouseGesture(event, "click", {
              surface: "editor",
              editorMode: editorModeOf(view),
            }),
          ) !== "edit"
        ) {
          return;
        }
        const element = citationElementAt(event);
        if (element !== null) {
          this.#editClick = {
            from: view.posAtDOM(element),
            x: event.clientX,
            y: event.clientY,
          };
        }
      }

      finishEditClick(event: MouseEvent, view: EditorView): boolean {
        const click = this.#editClick;
        this.#editClick = null;
        if (
          click === null ||
          handlers.navigationEnabled() ||
          event.shiftKey ||
          event.altKey ||
          citationClickIntent(
            mouseGesture(event, "click", {
              surface: "editor",
              editorMode: editorModeOf(view),
            }),
          ) !== "edit" ||
          !view.state.selection.main.empty ||
          Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4
        ) {
          return false;
        }
        view.dispatch({
          selection: { anchor: click.from + 1 },
          userEvent: "select.pointer",
        });
        view.focus();
        return true;
      }

      openAt(event: MouseEvent, view: EditorView): boolean {
        if (!handlers.navigationEnabled()) return false;
        if (citationElementAt(event) !== null) return false;

        const editorMode = editorModeOf(view);
        if (!view.state.selection.main.empty && editorMode === "live-preview")
          return false;
        const citekey = citekeyAtEvent(view, event);
        if (citekey === null) return false;

        const gesture = mouseGesture(event, "click", {
          surface: "editor",
          editorMode,
        });
        const { button, mod } = gesture;
        const intent = navigationIntent(gesture, {
          resolution: "open-or-create",
          citekey,
        });
        if (intent.kind !== "open") {
          if (logLevelEnabled("debug"))
            Effect.runSyncWith(logServices)(
              Effect.logDebug("Citekey click not followed").pipe(
                Effect.annotateLogs({
                  citekey,
                  editorMode,
                  button,
                  mod,
                  intent: intent.kind,
                }),
                withLogCategory("citekey-editor"),
              ),
            );
          return false;
        }
        if (logLevelEnabled("debug"))
          Effect.runSyncWith(logServices)(
            Effect.logDebug("Citekey click opens note").pipe(
              Effect.annotateLogs({
                citekey,
                editorMode,
                button,
                mod,
                pane: intent.pane,
              }),
              withLogCategory("citekey-editor"),
            ),
          );

        event.preventDefault();
        handlers.open(citekey, intent.pane);
        return true;
      }

      hoverAt(event: MouseEvent, view: EditorView): void {
        if (citationElementAt(event) !== null) return;
        const targetEl = citekeyElementAt(event);
        if (targetEl === null) return;

        const citekey = citekeyAtEvent(view, event);
        if (citekey === null) return;

        const editorMode = editorModeOf(view);
        const intent = citationHoverIntent(
          hoverGesture(event, { surface: "editor", editorMode }),
          handlers.hoverPreferences(),
          [citekey],
        );
        if (intent.kind === "nothing") {
          if (logLevelEnabled("trace"))
            Effect.runSyncWith(logServices)(
              Effect.logTrace("Citekey hover suppressed").pipe(
                Effect.annotateLogs({
                  citekey,
                  editorMode,
                  reason: intent.reason,
                }),
                withLogCategory("citekey-editor"),
              ),
            );
          return;
        }

        const info = view.state.field(editorInfoField, false);
        if (!info) return;

        if (intent.kind === "page-preview") {
          const notePath = handlers.hoverNotePath(
            intent.citekey,
            this.#lookup.current?.value ?? null,
          );
          if (notePath === null) {
            if (logLevelEnabled("trace"))
              Effect.runSyncWith(logServices)(
                Effect.logTrace("Citekey hover suppressed").pipe(
                  Effect.annotateLogs({
                    citekey,
                    editorMode,
                    reason: "no-note",
                  }),
                  withLogCategory("citekey-editor"),
                ),
              );
            return;
          }
          if (logLevelEnabled("trace"))
            Effect.runSyncWith(logServices)(
              Effect.logTrace("Citekey hover previews note").pipe(
                Effect.annotateLogs({
                  citekey,
                  editorMode,
                  path: notePath,
                }),
                withLogCategory("citekey-editor"),
              ),
            );
          triggerCitekeyHover(info.app.workspace, {
            event,
            hoverParent: info,
            targetEl,
            linktext: notePath,
            sourcePath: info.file?.path ?? "",
          });
          return;
        }

        if (logLevelEnabled("trace"))
          Effect.runSyncWith(logServices)(
            Effect.logTrace("Citekey shows its entry").pipe(
              Effect.annotateLogs({ citekey, editorMode }),
              withLogCategory("citekey-editor"),
            ),
          );
        handlers.showPopover({
          event,
          hoverParent: info,
          targetEl,
          sourcePath: info.file?.path ?? "",
          works: intent.citekeys.map((key) => {
            const resolution = this.#resolve(key);
            return {
              citekey: key,
              indexedKey:
                resolution?.kind === "unique"
                  ? resolution.item.indexedKey
                  : undefined,
            };
          }),
          open: handlers.open,
        });
      }

      #editedDocument(view: EditorView): EditedDocument | null {
        if (!handlers.showFormatted()) return null;
        if (!livePreviewOf(view.state)) return null;
        const file = view.state.field(editorInfoField, false)?.file;
        if (!file) return null;
        const held = handlers.citationText(file.path);
        return held === null
          ? null
          : { citations: held.value, path: file.path };
      }

      #rebuild(view: EditorView): void {
        const built = buildDecorations(view, handlers, {
          edited: this.#editedDocument(view),
          resolveCitekey: this.#resolve,
        });
        this.decorations = built.marks;
        this.widgets = built.widgets;
        this.#lookup.set({ citekeys: built.citekeys });
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      provide: (plugin) => {
        const widgets = (view: EditorView): DecorationSet =>
          view.plugin(plugin)?.widgets ?? Decoration.none;
        return [
          EditorView.atomicRanges.of(widgets),
          Prec.high(EditorView.decorations.of(widgets)),
        ];
      },
      eventHandlers: {
        click(event, view) {
          if (event.button !== 0) return false;
          if (this.finishEditClick(event, view)) return true;
          return this.openAt(event, view);
        },
        mousedown(event, view) {
          this.startEditClick(event, view);
          if (event.button !== 1) return false;
          return this.openAt(event, view);
        },
        mouseover(event, view) {
          this.hoverAt(event, view);
          return false;
        },
      },
    },
  );
}

interface EditedDocument {
  citations: DocumentCitations;
  path: string;
}

interface RenderedCitationWidget {
  content: PresentedCitation;
  source: string;
  footnote: boolean;
  navigable: boolean;
  navigation: CitationNavigation;
  themeClasses: readonly string[];
}

const renderedCitationWidgets = new WeakMap<
  HTMLElement,
  RenderedCitationWidget
>();

class CitationWidget extends WidgetType {
  readonly #source;
  readonly #content;
  readonly #shown;
  readonly #works;
  readonly #sourcePath;
  readonly #handlers;
  readonly #themeClasses;
  readonly #footnote;
  readonly #navigable;
  readonly #lookupRevision;

  constructor(options: {
    source: string;
    content: PresentedCitation;
    shown: ShownCitation;
    works: readonly CitedWork[];
    sourcePath: string;
    handlers: CitekeyEditorHandlers;
    themeClasses: readonly string[];
    footnote: boolean;
    navigable: boolean;
    lookupRevision: string;
  }) {
    super();
    this.#source = options.source;
    this.#content = options.content;
    this.#shown = options.shown;
    this.#works = options.works;
    this.#sourcePath = options.sourcePath;
    this.#handlers = options.handlers;
    this.#themeClasses = options.themeClasses;
    this.#footnote = options.footnote;
    this.#navigable = options.navigable;
    this.#lookupRevision = options.lookupRevision;
  }

  eq(other: CitationWidget): boolean {
    return (
      other.#lookupRevision === this.#lookupRevision &&
      other.#source === this.#source &&
      other.#content === this.#content &&
      other.#navigable === this.#navigable &&
      other.#footnote === this.#footnote
    );
  }

  updateDOM(element: HTMLElement, view: EditorView): boolean {
    const rendered = renderedCitationWidgets.get(element);
    if (
      rendered === undefined ||
      rendered.source !== this.#source ||
      !presentedCitationEqual(rendered.content, this.#content) ||
      rendered.navigable !== this.#navigable ||
      rendered.footnote !== this.#footnote ||
      rendered.themeClasses.length !== this.#themeClasses.length ||
      rendered.themeClasses.some(
        (themeClass, index) => themeClass !== this.#themeClasses[index],
      )
    ) {
      return false;
    }
    Object.assign(rendered.navigation, this.#navigation(view));
    renderedCitationWidgets.set(element, {
      source: this.#source,
      content: this.#content,
      navigable: this.#navigable,
      footnote: this.#footnote,
      navigation: rendered.navigation,
      themeClasses: this.#themeClasses,
    });
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = citationElement(view.dom.ownerDocument, this.#content, [
      themeHook.citationKey,
      ...this.#themeClasses,
      ...(this.#footnote ? [FOOTNOTE_WIDGET_CLASS] : []),
    ]);
    const navigation = this.#navigation(view);
    renderedCitationWidgets.set(element, {
      source: this.#source,
      content: this.#content,
      navigable: this.#navigable,
      footnote: this.#footnote,
      navigation,
      themeClasses: this.#themeClasses,
    });
    markCitationClick(element, this.#navigable ? "open" : "edit");
    if (this.#navigable) attachCitationNavigation(element, navigation);
    else attachClosedCitationGestures(element, navigation);
    return element;
  }

  #navigation(view: EditorView): CitationNavigation {
    return {
      works: this.#works,
      shown: this.#shown,
      where: { surface: "editor", editorMode: "live-preview" },
      open: this.#handlers.open,
      showPopover: this.#handlers.showPopover,
      hoverPreferences: this.#handlers.hoverPreferences,
      hoverNotePath: this.#handlers.hoverNotePath,
      workspace: this.#handlers.workspace,
      hoverTarget: () => {
        const info = view.state.field(editorInfoField, false);
        return info
          ? {
              workspace: info.app.workspace,
              hoverParent: info,
              sourcePath: this.#sourcePath,
            }
          : null;
      },
    };
  }

  ignoreEvent(event: Event): boolean {
    if (
      this.#navigable ||
      (event.type !== "mousedown" && event.type !== "click")
    ) {
      return true;
    }
    const mouse = event as MouseEvent;
    return (
      mouse.button !== 0 ||
      citationClickIntent(
        mouseGesture(mouse, "click", {
          surface: "editor",
          editorMode: "live-preview",
        }),
      ) !== "edit"
    );
  }
}

interface PlacedDecoration {
  from: number;
  to: number;
  decoration: Decoration;
  replaces: boolean;
}

function buildDecorations(
  view: EditorView,
  handlers: CitekeyEditorHandlers,
  {
    edited,
    resolveCitekey,
  }: {
    edited: EditedDocument | null;
    resolveCitekey: ResolveCitekey;
  },
): CitekeyDecorations {
  const marks = new RangeSetBuilder<Decoration>();
  const widgets = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const marksOf = CITEKEY_MARKS[handlers.navigationEnabled() ? "open" : "edit"];
  const selection = view.hasFocus ? state.selection.ranges : [];
  const visibleCitekeys = new Set<string>();
  let lastLineFrom = -1;
  for (const range of view.visibleRanges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.from === lastLineFrom) continue;
      lastLineFrom = line.from;

      const isRuledOut = (span: { start: number; end: number }): boolean =>
        isExcluded(state, line.from + span.start, line.from + span.end);

      const replaced: CitationRange[] = [];
      const placed: PlacedDecoration[] = [];
      if (edited !== null) {
        for (const citation of citationRanges(line.text, isRuledOut)) {
          for (const { citekey } of citation.keys) {
            visibleCitekeys.add(citekey);
          }
          const from = line.from + citation.start;
          const to = line.from + citation.end;
          if (overlapsSelection(selection, from, to)) continue;
          const widget = citationWidget({
            citation,
            start: from,
            edited,
            handlers,
            footnote: statesFootnoteTreatment(state, from, to),
          });
          if (widget === null) continue;
          replaced.push(citation);
          placed.push({
            from,
            to,
            decoration: Decoration.replace({ widget }),
            replaces: true,
          });
        }
      }

      const stated = stateCitekeyMarks(
        marksOutside(citekeyMarks(line.text, isRuledOut), replaced),
        (citekey) => {
          visibleCitekeys.add(citekey);
          return citekeyState(resolveCitekey(citekey));
        },
      );
      for (const mark of stated) {
        placed.push({
          from: line.from + mark.start,
          to: line.from + mark.end,
          decoration: marksOf[mark.state],
          replaces: false,
        });
      }

      placed.sort((a, b) => a.from - b.from);
      for (const { from, to, decoration, replaces } of placed) {
        (replaces ? widgets : marks).add(from, to, decoration);
      }
    }
  }
  return {
    marks: marks.finish(),
    widgets: widgets.finish(),
    citekeys: [...visibleCitekeys],
  };
}

function citationWidget(options: {
  citation: CitationRange;
  start: number;
  edited: EditedDocument;
  handlers: CitekeyEditorHandlers;
  footnote: boolean;
}): CitationWidget | null {
  const {
    citation,
    start,
    edited: { citations, path },
    handlers,
    footnote,
  } = options;
  const at: CitationCoordinate = { kind: "offset", start };
  const content = citationContent(citation, citations, at);
  if (content === null) return null;
  const stateOf = literalKeyStateOf(citations);
  const themeClasses = citationStateHooks(
    citationState(citationKeyStates(citation, stateOf)),
  );
  return new CitationWidget({
    source: citation.source,
    content,
    shown: { citation, at },
    works: citedWorks(citation, citations),
    sourcePath: path,
    handlers: {
      ...handlers,
      hoverNotePath: (citekey) =>
        handlers.hoverNotePath(citekey, citations.lookup),
    },
    themeClasses,
    footnote,
    navigable: handlers.navigationEnabled(),
    lookupRevision: citations.lookup.revision,
  });
}

function citekeyElementAt(event: MouseEvent): HTMLElement | null {
  const target = event.target as Node | null;
  const relatedTarget = event.relatedTarget as Node | null;
  if (!target?.instanceOf(HTMLElement)) return null;
  const targetEl = target.closest<HTMLElement>(`.${themeHook.citationKey}`);
  if (targetEl === null) return null;
  if (relatedTarget?.instanceOf(Node) && targetEl.contains(relatedTarget)) {
    return null;
  }
  return targetEl;
}

function citationElementAt(event: MouseEvent): HTMLElement | null {
  const target = event.target as Node | null;
  if (!target?.instanceOf(HTMLElement)) return null;
  return target.closest<HTMLElement>(`.${themeHook.citation}`);
}

function citekeyAtEvent(view: EditorView, event: MouseEvent): string | null {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return null;
  return citekeyAtPos(view.state, pos);
}

function editorModeOf(view: EditorView): EditorMode {
  return view.dom.closest(".is-live-preview") ? "live-preview" : "source";
}

export function citekeyAtPos(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  const from = line.from;
  for (const mark of citekeyMarks(line.text, (span) =>
    isExcluded(state, from + span.start, from + span.end),
  )) {
    if (pos >= from + mark.start && pos <= from + mark.end) {
      return mark.citekey;
    }
  }
  return null;
}

function statesFootnoteTreatment(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  let inside = false;
  let wrapped = false;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (wrapped) return false;
      if (node.to <= from || node.from >= to) return false;
      const classes = node.type.prop(tokenClassNodeProp);
      if (classes === undefined || !isFootnoteTokenClass(classes)) return true;
      inside = true;
      wrapped = node.from < from && node.to > to;
      return !wrapped;
    },
  });
  return inside && !wrapped;
}

function isExcluded(state: EditorState, from: number, to: number): boolean {
  let excluded = false;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (excluded) return false;
      const classes =
        node.type.prop(tokenClassNodeProp) ?? node.type.prop(lineClassNodeProp);
      if (classes !== undefined && isExcludedTokenClass(classes)) {
        excluded = true;
        return false;
      }
      return true;
    },
  });
  return excluded;
}
