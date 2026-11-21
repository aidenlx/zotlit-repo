// The authoring tabs, in the order the pane offers them, with the label and
// the lede each opens with. The Template Document kind picks the set.

import type {
  WorkbenchDocumentKind,
  WorkbenchProblem,
} from "#core/document/controller.ts";

import * as m from "@zotlit/plugin-messages/messages.ts";

export type WorkbenchTab =
  | "note"
  | "annotation"
  | "properties"
  | "name"
  | "profile"
  | "match"
  | "citation"
  | "partial";

/** The tabs a Profile document opens with. */
export const TABS: readonly WorkbenchTab[] = [
  "note",
  "properties",
  "annotation",
  "name",
  "match",
  "profile",
];

/** The manifest's `details` fields the Profile tab edits; the rest are the Name and folder tab's. */
const PROFILE_FIELDS: readonly string[] = [
  "name",
  "description",
  "version",
  "author",
  "sampleItemType",
  "language",
];

/** Whether `problem` names a manifest field the Profile tab edits. */
export const isProfileProblem = (
  problem: Pick<WorkbenchProblem, "slice" | "params">,
): boolean =>
  problem.slice === "details" &&
  PROFILE_FIELDS.includes(problem.params?.field ?? "");

const KIND_TABS: Record<WorkbenchDocumentKind, readonly WorkbenchTab[]> = {
  profile: TABS,
  citation: ["citation"],
  partial: ["partial"],
};

/** The tabs `kind` shows, in the order the tab strip offers them. */
export function tabsFor(kind: WorkbenchDocumentKind): readonly WorkbenchTab[] {
  return KIND_TABS[kind];
}

const TAB_LABEL: Record<WorkbenchTab, () => string> = {
  note: m.workbench_tab_note,
  annotation: m.workbench_tab_annotation,
  properties: m.workbench_tab_properties,
  match: m.workbench_tab_match,
  name: m.workbench_tab_name_and_folder,
  profile: m.workbench_tab_profile,
  citation: m.workbench_tab_citation,
  partial: m.workbench_tab_partial,
};

const TAB_LEDE: Record<WorkbenchTab, () => string> = {
  note: m.workbench_note_lede,
  annotation: m.workbench_annotation_lede,
  properties: m.workbench_properties_lede,
  match: m.workbench_match_conditions_desc,
  name: m.workbench_name_lede,
  profile: m.workbench_profile_lede,
  citation: m.workbench_citation_lede,
  partial: m.workbench_partial_lede,
};

/** The docs page that shows how to write each tab's part of the template. */
const TAB_DOCS: Record<
  WorkbenchTab,
  { readonly label: () => string; readonly path: string }
> = {
  note: {
    label: m.workbench_docs_note,
    path: "/docs/reference/templates/syntax",
  },
  annotation: {
    label: m.workbench_docs_annotation,
    path: "/docs/how-to/customize-template",
  },
  properties: {
    label: m.workbench_docs_properties,
    path: "/docs/how-to/configure-frontmatter-properties",
  },
  match: {
    label: m.workbench_docs_match,
    path: "/docs/how-to/use-different-templates",
  },
  name: {
    label: m.workbench_docs_name,
    path: "/docs/how-to/customize-a-template",
  },
  profile: {
    label: m.workbench_docs_profile,
    path: "/docs/reference/templates/how-templates-work#profiles",
  },
  citation: {
    label: m.workbench_docs_citation,
    path: "/docs/how-to/customize-a-template#citation-text",
  },
  partial: {
    label: m.workbench_docs_partial,
    path: "/docs/how-to/customize-a-template#share-a-partial",
  },
};

/** The guide link for `tab`: its text and its path under the docs site. */
export function tabDocs(tab: WorkbenchTab): { label: string; path: string } {
  const { label, path } = TAB_DOCS[tab];
  return { label: label(), path };
}

export function tabLabel(tab: WorkbenchTab): string {
  return TAB_LABEL[tab]();
}

export function tabLede(tab: WorkbenchTab): string {
  return TAB_LEDE[tab]();
}
