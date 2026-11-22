import type {
  CitationOccurrence,
  CitedByGroup,
} from "#obsidian/citation-index/service.ts";
import { Option, Schema } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createContext, useContext } from "react";

import {
  CITED_BY_SORT_GROUPS,
  DEFAULT_CITED_BY_SORT,
  excerptKey,
  excerptKeyIn,
  excerptRange,
  expandExcerptRange,
  occurrenceID,
  previewContexts,
} from "./store.ts";
import type {
  CitedBySortMode,
  ExpandDirection,
  ReadyPreview,
  SourceRange,
} from "./store.ts";

export interface CitedByLayout {
  readonly search: string;
  readonly searchVisible: boolean;
  readonly moreContext: boolean;
  readonly sort: CitedBySortMode;
}

export interface CitedByNoteState {
  readonly collapsed: readonly string[];
  readonly expansions: Readonly<Record<string, SourceRange>>;
}

export interface CitedByModel {
  readonly layout: Atom.Writable<CitedByLayout>;
  readonly note: Atom.Writable<CitedByNoteState>;
}

export const DEFAULT_CITED_BY_LAYOUT: CitedByLayout = {
  search: "",
  searchVisible: false,
  moreContext: false,
  sort: DEFAULT_CITED_BY_SORT,
};

export const EMPTY_CITED_BY_NOTE_STATE: CitedByNoteState = {
  collapsed: [],
  expansions: {},
};

export function makeCitedByModel(
  layout: Partial<CitedByLayout> = {},
): CitedByModel {
  return {
    layout: Atom.make<CitedByLayout>({ ...DEFAULT_CITED_BY_LAYOUT, ...layout }),
    note: Atom.make(EMPTY_CITED_BY_NOTE_STATE),
  };
}

export function holdCitedByModel(
  registry: AtomRegistry.AtomRegistry,
  model: CitedByModel,
): () => void {
  const releases = [registry.mount(model.layout), registry.mount(model.note)];
  return () => {
    for (const release of releases) release();
  };
}

const SAVED_LAYOUT = {
  search: Schema.String,
  searchVisible: Schema.Boolean,
  moreContext: Schema.Boolean,
  sort: Schema.Literals(CITED_BY_SORT_GROUPS.flat()),
} satisfies { [K in keyof CitedByLayout]: Schema.Codec<CitedByLayout[K]> };

export function readSavedLayout(state: unknown): Partial<CitedByLayout> {
  if (!state || typeof state !== "object") return {};
  const saved = state as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(SAVED_LAYOUT).flatMap(([key, schema]) =>
      Option.match(
        Schema.decodeUnknownOption(schema as Schema.Codec<unknown>)(saved[key]),
        { onNone: () => [], onSome: (value) => [[key, value]] },
      ),
    ),
  );
}

export const toggleSearch = (layout: CitedByLayout): CitedByLayout =>
  layout.searchVisible
    ? { ...layout, searchVisible: false, search: "" }
    : { ...layout, searchVisible: true };

export const toggleGroup =
  (path: string) =>
  (note: CitedByNoteState): CitedByNoteState => ({
    ...note,
    collapsed: note.collapsed.includes(path)
      ? note.collapsed.filter((item) => item !== path)
      : [...note.collapsed, path],
  });

export const collapseAll =
  (paths: readonly string[]) =>
  (note: CitedByNoteState): CitedByNoteState => ({
    ...note,
    collapsed: [...new Set([...note.collapsed, ...paths])],
  });

export const expandAll =
  (paths?: readonly string[]) =>
  (note: CitedByNoteState): CitedByNoteState => ({
    ...note,
    collapsed: paths
      ? note.collapsed.filter((path) => !paths.includes(path))
      : [],
  });

export const expandExcerpt =
  (options: {
    readonly preview: ReadyPreview;
    readonly moreContext: boolean;
    readonly group: CitedByGroup;
    readonly occurrence: CitationOccurrence;
    readonly direction: ExpandDirection;
  }) =>
  (note: CitedByNoteState): CitedByNoteState => {
    const { preview, moreContext, group, occurrence, direction } = options;
    const context = previewContexts(preview, [occurrence])[
      occurrenceID(occurrence)
    ];
    if (context?.status !== "ready") return note;
    const key = excerptKey(group.path, occurrence);
    const range = expandExcerptRange({
      source: preview.source,
      outline: preview.outline,
      range: excerptRange(context, {
        moreContext,
        expansion: note.expansions[key],
      }),
      direction,
    });
    return { ...note, expansions: { ...note.expansions, [key]: range } };
  };

export const dropExpansions =
  (paths: readonly string[]) =>
  (note: CitedByNoteState): CitedByNoteState => {
    const kept = Object.entries(note.expansions).filter(
      ([key]) => !paths.some((path) => excerptKeyIn(key, path)),
    );
    return kept.length === Object.keys(note.expansions).length
      ? note
      : { ...note, expansions: Object.fromEntries(kept) };
  };

export const CitedByModelContext = createContext<CitedByModel | null>(null);

export function useCitedByModel(): CitedByModel {
  const model = useContext(CitedByModelContext);
  if (!model) {
    throw new Error("useCitedByModel must be used within CitedByModelContext");
  }
  return model;
}
