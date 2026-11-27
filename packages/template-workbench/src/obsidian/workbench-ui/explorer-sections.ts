import type { DisplayNode } from "#core/data-tree/index.ts";
import type { IconName } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";
import type { FieldLabelLocale } from "@zotlit/zotero-types/field-labels";

import { COMMON_FIELDS } from "./completion-fields.ts";
import type { FieldRow } from "./explorer-fields.ts";
import { commonRows, fieldValueText } from "./explorer-fields.ts";
import type { TemplateRoot } from "./model.ts";

import { buildDisplayTree, listPropertiesOf } from "#core/data-tree/index.ts";

export type ExplorerSectionId =
  | "common"
  | "reference"
  | "identifiers"
  | "content"
  | "organization"
  | "links"
  | "record"
  | "annotation"
  | "source"
  | "citation";

export interface ExplorerSection {
  readonly id: ExplorerSectionId;
  readonly label: string;
  readonly rows: readonly FieldRow[];
}

interface SectionSpec {
  readonly id: ExplorerSectionId;
  readonly keys: readonly string[];
}

const SECTION_LABELS: Record<ExplorerSectionId, () => string> = {
  common: m.workbench_explorer_section_common,
  reference: m.workbench_explorer_section_reference,
  identifiers: m.workbench_explorer_section_identifiers,
  content: m.workbench_explorer_section_content,
  organization: m.workbench_explorer_section_organization,
  links: m.workbench_explorer_section_links,
  record: m.workbench_explorer_section_record,
  annotation: m.workbench_explorer_section_annotation,
  source: m.workbench_explorer_section_source,
  citation: m.workbench_explorer_section_citation,
};

export const SECTION_ICONS: Record<ExplorerSectionId, IconName> = {
  common: "layout-list",
  reference: "book-marked",
  identifiers: "fingerprint",
  content: "paperclip",
  organization: "folder-tree",
  links: "link",
  record: "database",
  annotation: "highlighter",
  source: "file-text",
  citation: "quote",
};

const ITEM_SECTIONS: readonly SectionSpec[] = [
  {
    id: "reference",
    keys: [
      "title",
      "shortTitle",
      "authors",
      "authorsShort",
      "creators",
      "primaryCreatorType",
      "date",
      "volume",
      "issue",
      "pages",
      "publisher",
      "place",
      "edition",
      "language",
      "itemType",
    ],
  },
  {
    id: "identifiers",
    keys: ["citationKey", "citekey", "DOI", "ISBN", "ISSN", "url", "extra"],
  },
  { id: "content", keys: ["abstract", "attachments", "annotations", "notes"] },
  { id: "organization", keys: ["tags", "collections", "relatedItems"] },
  {
    id: "links",
    keys: ["backlink", "weblink", "librarylink", "noteLink", "notePath"],
  },
  {
    id: "record",
    keys: [
      "key",
      "indexedKey",
      "libraryID",
      "groupID",
      "dateAdded",
      "dateModified",
    ],
  },
];

const SECTIONS: Record<TemplateRoot, readonly SectionSpec[]> = {
  note: ITEM_SECTIONS,
  filename: ITEM_SECTIONS,
  annotation: [
    {
      id: "annotation",
      keys: [
        "type",
        "text",
        "comment",
        "commentHtml",
        "colorName",
        "colorHex",
        "pageLabel",
        "page",
        "imgLink",
      ],
    },
    {
      id: "source",
      keys: ["parentItem", "parentAttachment", "fileLink", "citation"],
    },
    { id: "organization", keys: ["tags"] },
    { id: "links", keys: ["backlink"] },
    {
      id: "record",
      keys: [
        "key",
        "indexedKey",
        "libraryID",
        "authorName",
        "isExternal",
        "dateAdded",
        "dateModified",
      ],
    },
  ],
  citation: [{ id: "citation", keys: [] }],
};

const ITEM_HIDDEN: readonly string[] = ["abstractNote", "containerTitle"];
const HIDDEN: Record<TemplateRoot, ReadonlySet<string>> = {
  note: new Set(ITEM_HIDDEN),
  annotation: new Set(),
  filename: new Set([...ITEM_HIDDEN, "notePath", "noteLink"]),
  citation: new Set(),
};

const ITEM_LABELS: Readonly<Record<string, () => string>> = {
  authorsShort: m.workbench_field_authors_short,
  creators: m.workbench_field_creators,
  primaryCreatorType: m.workbench_field_primary_creator_type,
  citekey: m.workbench_field_citekey,
  relatedItems: m.workbench_field_related_items,
  notes: m.workbench_field_notes,
  weblink: m.workbench_field_weblink,
  librarylink: m.workbench_field_librarylink,
  key: m.workbench_field_key,
  indexedKey: m.workbench_field_indexed_key,
  libraryID: m.workbench_field_library_id,
  groupID: m.workbench_field_group_id,
  notePath: m.workbench_field_note_path,
  noteLink: m.workbench_field_note_link,
};

const ANNOTATION_LABELS: Readonly<Record<string, () => string>> = {
  type: m.workbench_field_annotation_type,
  commentHtml: m.workbench_field_comment_html,
  colorHex: m.workbench_field_color_hex,
  page: m.workbench_field_page_number,
  parentAttachment: m.workbench_field_parent_attachment,
  fileLink: m.workbench_field_file_link,
  citation: m.workbench_field_citation,
  authorName: m.workbench_field_author_name,
  isExternal: m.workbench_field_is_external,
  key: m.workbench_field_key,
  indexedKey: m.workbench_field_indexed_key,
  libraryID: m.workbench_field_library_id,
};

const ZOTERO_FIELD: Readonly<Record<string, string>> = {
  abstract: "abstractNote",
};

export function schemaLocale(locale: string): FieldLabelLocale {
  return locale.startsWith("zh") ? "zh-CN" : "en-US";
}

export function sentenceCase(label: string): string {
  return label.replaceAll(/(?<=\S\s+)\p{Lu}(?=\p{Ll})/gu, (initial) =>
    initial.toLowerCase(),
  );
}

export interface ExplorerReader {
  readonly root: TemplateRoot;
  readonly locale: string;
}

export function fieldLabel(
  key: string,
  { root, locale }: ExplorerReader,
): string {
  const common = COMMON_FIELDS[root].find((field) => field.key === key);
  if (common) return common.label();
  const own = (root === "annotation" ? ANNOTATION_LABELS : ITEM_LABELS)[key];
  if (own) return own();
  const schema = schemaLocale(locale);
  const zotero = FIELD_LABELS[schema][ZOTERO_FIELD[key] ?? key];
  if (zotero === undefined) return key;
  return schema === "en-US" ? sentenceCase(zotero) : zotero;
}

export function listPropertyLabels(
  nodes: readonly DisplayNode[],
  reader: ExplorerReader,
): [string, string][] {
  return nodes
    .flatMap(listPropertiesOf)
    .flatMap((child): [string, string][] => {
      const root =
        reader.root === "note" && isNoteAnnotations(child.list)
          ? "annotation"
          : reader.root;
      const label = fieldLabel(child.property, { ...reader, root });
      return label === child.property ? [] : [[child.key, label]];
    });
}

function isNoteAnnotations(list: DisplayNode["path"]): boolean {
  return list.length === 1 && list[0] === "annotations";
}

export function explorerSectionIds(root: TemplateRoot): ExplorerSectionId[] {
  return ["common", ...SECTIONS[root].map((section) => section.id)];
}

export function visibleSectionIds(
  data: Record<string, unknown> | null,
  reader: ExplorerReader,
): ExplorerSectionId[] {
  if (!data) return [];
  const nodes = buildDisplayTree(data, { expanded: new Set() });
  return explorerSections(nodes, reader).map((section) => section.id);
}

export function explorerSections(
  nodes: readonly DisplayNode[],
  reader: ExplorerReader,
): ExplorerSection[] {
  const { root } = reader;
  const hidden = HIDDEN[root];
  const byKey = new Map(
    nodes.filter((node) => !hidden.has(node.key)).map((n) => [n.key, n]),
  );
  const row = (node: DisplayNode): FieldRow => ({
    node,
    label: fieldLabel(node.key, reader),
    value: fieldValueText(node),
  });
  const common = commonRows(root, [...byKey.values()]);
  const placed = new Set(common.map(({ node }) => node.key));
  const specs = SECTIONS[root];
  const rowsOf = new Map(specs.map((spec) => [spec.id, [] as FieldRow[]]));
  for (const spec of specs)
    for (const key of spec.keys) {
      const node = byKey.get(key);
      if (!node || placed.has(key)) continue;
      placed.add(key);
      rowsOf.get(spec.id)!.push(row(node));
    }
  const first = rowsOf.get(specs[0]!.id)!;
  for (const node of byKey.values())
    if (!placed.has(node.key)) first.push(row(node));
  const sections: ExplorerSection[] = [
    { id: "common", label: SECTION_LABELS.common(), rows: common },
  ];
  for (const spec of specs)
    sections.push({
      id: spec.id,
      label: SECTION_LABELS[spec.id](),
      rows: rowsOf.get(spec.id)!,
    });
  return sections.filter((section) => section.rows.length > 0);
}
