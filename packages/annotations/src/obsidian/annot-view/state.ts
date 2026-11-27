import type { CardPlace } from "#core/annot-view/card-selection.ts";
import type { CardSelection } from "#core/annot-view/card-selection.ts";
import type {
  AnnotationRecord,
  AnnotationSource,
  EditingCapability,
  MutationState,
  TagDraft,
  TextField,
  TextFieldDraft,
} from "#obsidian/annotation-repository/service.ts";

import type { AnnotViewAttachment } from "@zotlit/db";
import { toggledValues } from "@zotlit/obsidian-kit/components/chooser-logic.ts";
import type { ItemSummary } from "@zotlit/plugin-kernel/item-summary.ts";

import type { CaretPoint } from "./editor-sheet.ts";
import type { AnnotFilter } from "./filter.ts";
import { filterAnnotations } from "./filter.ts";

import { cardPlace, NO_SELECTION } from "#core/annot-view/card-selection.ts";
import { byTextField } from "#obsidian/annotation-repository/write.ts";

export type FollowMode = "active-tab" | "zotero-reader" | "pinned";

export type AttachmentLock = "obsidian-pdf" | "zotero-reader" | null;

export type EditingField = TextField | "tags";

export type FieldDrafts = Readonly<
  Record<TextField, ReadonlyMap<string, TextFieldDraft>>
>;

export function noFieldDrafts(): FieldDrafts {
  return byTextField(() => new Map());
}

export interface EditingTarget {
  annotationKey: string;
  field: EditingField;
  caretAt?: CaretPoint;
}

export interface HeldSource {
  source: AnnotationSource;
  scope: string | null;
}

export interface AnnotState {
  attachments: AnnotViewAttachment[] | null;
  selectedAttachmentKey: string | null;
  attachmentLock: AttachmentLock;
  annotations: readonly AnnotationRecord[] | null;
  sources: ReadonlyMap<string, HeldSource>;
  capabilities: ReadonlyMap<string, EditingCapability>;
  capability: EditingCapability;
  mutations: ReadonlyMap<string, MutationState>;
  fieldDrafts: FieldDrafts;
  tagDrafts: ReadonlyMap<string, TagDraft>;
  editing: EditingTarget | null;
  cardSelection: CardSelection;
  itemKey: string | null;
  itemDisplay: ItemSummary | null;
  groupID: number | null;
  followMode: FollowMode;
  previousMode: FollowMode;
  pinnedItemKey: string | null;
  pinnable: string | null;
  liveUpdatesOn: boolean;
  zoteroReaderClosed: boolean;
  searchOpen: boolean;
  filterQuery: string;
  selectedColors: string[];
  selectedTags: string[];
  groups: readonly CardPlacement[] | null;
  collapsedGroups: ReadonlySet<string>;
  unresolved: readonly string[];
  queryProblem: { message: string; detail: string } | null;
  filterError: boolean;
}

export interface CardGroup {
  key: string;
  label: string;
}

export interface CardPlacement {
  annotationKey: string;
  group: CardGroup;
}

export const INITIAL_FILTER_STATE: Pick<
  AnnotState,
  "searchOpen" | "filterQuery" | "selectedColors" | "selectedTags"
> = {
  searchOpen: false,
  filterQuery: "",
  selectedColors: [],
  selectedTags: [],
};

export function initialAnnotState(): AnnotState {
  return {
    attachments: null,
    selectedAttachmentKey: null,
    attachmentLock: null,
    annotations: null,
    sources: new Map(),
    capabilities: new Map(),
    capability: { kind: "read-only", reason: "probing" },
    mutations: new Map(),
    fieldDrafts: noFieldDrafts(),
    tagDrafts: new Map(),
    editing: null,
    cardSelection: NO_SELECTION,
    itemKey: null,
    itemDisplay: null,
    groupID: null,
    followMode: "active-tab",
    previousMode: "active-tab",
    pinnedItemKey: null,
    pinnable: null,
    liveUpdatesOn: false,
    zoteroReaderClosed: false,
    ...INITIAL_FILTER_STATE,
    groups: null,
    collapsedGroups: new Set(),
    unresolved: [],
    queryProblem: null,
    filterError: false,
  };
}

export function capabilityOf(
  state: Pick<AnnotState, "capabilities" | "capability">,
  attachmentKey: string,
): EditingCapability {
  return state.capabilities.get(attachmentKey) ?? state.capability;
}

export function selectActiveAttachment(
  s: Pick<AnnotState, "attachments" | "selectedAttachmentKey">,
): AnnotViewAttachment | null {
  if (!s.attachments || s.attachments.length === 0) return null;
  return (
    s.attachments.find((a) => a.indexedKey === s.selectedAttachmentKey) ??
    s.attachments[0]!
  );
}

export function editorOpen(state: Pick<AnnotState, "editing">): boolean {
  return state.editing !== null;
}

export function fieldDraft(
  state: Pick<AnnotState, "fieldDrafts">,
  field: TextField,
  annotationKey: string,
): TextFieldDraft | null {
  return state.fieldDrafts[field].get(annotationKey) ?? null;
}

export function selectedAlone(
  state: Pick<AnnotState, "cardSelection">,
  annotationKey: string,
): boolean {
  const { selected } = state.cardSelection;
  return selected.length === 1 && selected[0] === annotationKey;
}

export function isEditing(
  state: Pick<AnnotState, "editing">,
  annotationKey: string,
  field: EditingField,
): boolean {
  return (
    state.editing?.annotationKey === annotationKey &&
    state.editing.field === field
  );
}

type FilterSlices = Pick<
  AnnotState,
  "filterQuery" | "selectedColors" | "selectedTags"
>;

export function filterOf(s: FilterSlices): AnnotFilter {
  return {
    query: s.filterQuery,
    colors: s.selectedColors,
    tags: s.selectedTags,
  };
}

export interface GroupedCard {
  annot: AnnotationRecord;
  group: CardGroup;
  opens: boolean;
}

export function groupedCards(
  groups: readonly CardPlacement[],
  shown: readonly AnnotationRecord[],
): GroupedCard[] {
  const byKey = new Map(shown.map((annot) => [annot.key, annot]));
  const cards: GroupedCard[] = [];
  for (const { annotationKey, group } of groups) {
    const annot = byKey.get(annotationKey);
    if (!annot) continue;
    cards.push({ annot, group, opens: cards.at(-1)?.group.key !== group.key });
  }
  return cards;
}

type OrderSlices = FilterSlices &
  Pick<AnnotState, "groups" | "collapsedGroups">;

const orders = new WeakMap<
  readonly AnnotationRecord[],
  { slices: OrderSlices; order: readonly CardPlace[] }
>();

export function visibleOrder(
  s: OrderSlices & Pick<AnnotState, "annotations">,
): readonly CardPlace[] {
  if (s.annotations === null) return [];
  const held = orders.get(s.annotations);
  if (
    held?.slices.filterQuery === s.filterQuery &&
    held.slices.selectedColors === s.selectedColors &&
    held.slices.selectedTags === s.selectedTags &&
    held.slices.groups === s.groups &&
    held.slices.collapsedGroups === s.collapsedGroups
  )
    return held.order;
  const { filterQuery, selectedColors, selectedTags, groups, collapsedGroups } =
    s;
  const shown = filterAnnotations(s.annotations, filterOf(s));
  const order =
    groups === null
      ? shown.map(({ key }) => cardPlace(key, null))
      : groupedCards(groups, shown).flatMap(({ annot, group }) =>
          collapsedGroups.has(group.key)
            ? []
            : [cardPlace(annot.key, group.key)],
        );
  orders.set(s.annotations, {
    slices: {
      filterQuery,
      selectedColors,
      selectedTags,
      groups,
      collapsedGroups,
    },
    order,
  });
  return order;
}

export function toggledTags(selectedTags: string[], tag: string): string[] {
  return toggledValues(selectedTags, tag);
}
