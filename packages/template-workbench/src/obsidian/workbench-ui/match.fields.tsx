import type {
  CustomFilterFieldKind,
  DatasetFilterFieldKind,
  FilterDataset,
  FilterField,
  FilterFieldKind,
  FilterOperator,
  FilterRow,
} from "#core/filter-fields/fields.ts";
import type { IconName } from "obsidian";
import type { ReactNode } from "react";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import { useContainerName } from "./host.tsx";
import { ChipInput } from "./match.chips.tsx";
import type {
  MatchConditionKind,
  MatchVocabulary,
  RowCondition,
} from "./match.draft.ts";
import { MatchInput } from "./match.input.tsx";
import { MatchSelect } from "./match.rows.tsx";

import {
  FILTER_OPERATORS,
  filterFields,
  isDatasetFieldKind,
  formatFilterRow,
  freshFilterRow,
  parseFilterRow,
  withOperator,
} from "#core/filter-fields/fields.ts";

const matchControl =
  "zt:min-w-0 zt:max-w-full zt:[div&]:flex zt:[div&]:flex-col zt:[span&]:px-2 zt:[span&]:pb-1 zt:[span&]:text-xs zt:[span&]:leading-normal zt:[span&]:text-muted-foreground";
const matchInput =
  "zt:min-h-(--input-height) zt:min-w-0 zt:w-full zt:flex-auto zt:shrink-0";

export interface FilterValues {
  readonly tags: readonly string[];
  readonly collections: readonly string[];
  readonly libraries: readonly { id: string; name: string | null }[];
}

type Label = () => string;

type NamedFilterFieldKind = Exclude<
  FilterFieldKind,
  CustomFilterFieldKind | DatasetFilterFieldKind
>;

const KIND_LABELS: Record<NamedFilterFieldKind, Label> = {
  color: m.workbench_filter_field_color,
  tags: m.workbench_filter_field_tag,
  comment: m.workbench_filter_field_comment,
  text: m.workbench_filter_field_text,
  page: m.workbench_filter_field_page,
  "date-added": m.workbench_filter_field_date_added,
  "date-modified": m.workbench_filter_field_date_modified,
  "item-title": m.workbench_filter_field_item_title,
  creators: m.workbench_filter_field_creator,
  "first-author": m.workbench_filter_field_first_author,
  year: m.workbench_filter_field_year,
  "item-type": m.workbench_filter_field_item_type,
  collection: m.workbench_filter_field_collection,
  library: m.workbench_filter_field_library,
  "attachment-title": m.workbench_filter_field_attachment_title,
  "file-type": m.workbench_filter_field_file_type,
};

const OPERATOR_LABELS: Record<FilterOperator, Label> = {
  contains: m.workbench_filter_op_contains,
  "does-not-contain": m.workbench_filter_op_does_not_contain,
  "contains-match-case": m.workbench_filter_op_contains_match_case,
  "does-not-contain-match-case":
    m.workbench_filter_op_does_not_contain_match_case,
  "contains-any": m.workbench_filter_op_contains_any,
  "contains-all": m.workbench_filter_op_contains_all,
  within: m.workbench_filter_op_within,
  "not-within": m.workbench_filter_op_not_within,
  is: m.workbench_filter_op_is,
  "is-not": m.workbench_filter_op_is_not,
  "is-empty": m.workbench_filter_op_is_empty,
  "is-not-empty": m.workbench_filter_op_is_not_empty,
  before: m.workbench_filter_op_before,
  after: m.workbench_filter_op_after,
  "on-or-before": m.workbench_filter_op_on_or_before,
  "on-or-after": m.workbench_filter_op_on_or_after,
  "is-true": m.workbench_filter_op_is_true,
  "is-false": m.workbench_filter_op_is_false,
};

const COLLECTION_LABELS: Partial<Record<FilterOperator, Label>> = {
  contains: m.workbench_filter_op_is,
  "does-not-contain": m.workbench_filter_op_is_not,
  "contains-any": m.workbench_filter_op_is_any,
  "contains-all": m.workbench_filter_op_is_all,
  "is-empty": m.workbench_filter_op_is_empty,
  "is-not-empty": m.workbench_filter_op_is_not_empty,
};

const COLORS: readonly [string, Label][] = [
  ["yellow", m.workbench_filter_color_yellow],
  ["red", m.workbench_filter_color_red],
  ["green", m.workbench_filter_color_green],
  ["blue", m.workbench_filter_color_blue],
  ["purple", m.workbench_filter_color_purple],
  ["magenta", m.workbench_filter_color_magenta],
  ["orange", m.workbench_filter_color_orange],
  ["gray", m.workbench_filter_color_gray],
  ["plum", m.workbench_filter_color_plum],
];

const FILE_TYPES: readonly [string, Label][] = [
  ["pdf", m.workbench_filter_file_type_pdf],
  ["epub", m.workbench_filter_file_type_epub],
  ["web", m.workbench_filter_file_type_web],
  ["other", m.workbench_filter_file_type_other],
];

function choices(
  kind: FilterFieldKind,
  { values, locale }: { values: FilterValues; locale: string },
): readonly [string, string][] {
  switch (kind) {
    case "color":
      return COLORS.map(([value, label]) => [value, label()]);
    case "file-type":
      return FILE_TYPES.map(([value, label]) => [value, label()]);
    case "item-type": {
      const labels = locale === "zh-CN" ? "zh-CN" : "en-US";
      return ITEM_TYPES.map((type) => [type.name, type.labels[labels]]);
    }
    case "library":
      return values.libraries.map(({ id, name }) => [
        id,
        id === "personal"
          ? m.workbench_filter_library_personal()
          : (name ?? id),
      ]);
    default:
      return [];
  }
}

function RowOperator({
  field,
  condition,
  onChange,
}: {
  field: FilterField;
  condition: FilterRow;
  onChange: (next: FilterRow) => void;
}) {
  return (
    <MatchSelect
      aria-label={m.workbench_filter_operator()}
      value={condition.operator}
      onChange={(value) =>
        onChange(withOperator(condition, value as FilterOperator))
      }
      options={FILTER_OPERATORS[field.type].map((operator) => ({
        value: operator,
        label: (field.type === "collection"
          ? (COLLECTION_LABELS[operator] ?? OPERATOR_LABELS[operator])
          : OPERATOR_LABELS[operator])(),
      }))}
    />
  );
}

function RowValue({
  field,
  condition,
  values,
  onChange,
}: {
  field: FilterField;
  condition: FilterRow;
  values: FilterValues;
  onChange: (next: FilterRow) => void;
}) {
  const valueName = useContainerName(m.workbench_filter_value());
  const { operator } = condition;
  if (
    operator === "is-empty" ||
    operator === "is-not-empty" ||
    field.type === "boolean"
  )
    return null;
  const suggestions =
    field.kind === "tags"
      ? values.tags
      : field.type === "collection"
        ? values.collections
        : undefined;
  const placeholder =
    field.kind === "tags"
      ? m.workbench_filter_tag_placeholder()
      : field.type === "collection"
        ? m.workbench_filter_collection_placeholder()
        : m.workbench_filter_value();
  if (operator === "contains-any" || operator === "contains-all")
    return (
      <ChipInput
        values={condition.values}
        onChange={(next) => onChange({ ...condition, values: next })}
        placeholder={placeholder}
        suggestions={suggestions}
      />
    );
  if (field.type === "choice") {
    const options = choices(field.kind, {
      values,
      locale: runtime.getLocale(),
    });
    return (
      <MatchSelect
        searchable={field.kind === "item-type" || field.kind === "library"}
        data-part="control"
        className={matchControl}
        aria-label={m.workbench_filter_value()}
        value={condition.value}
        onChange={(value) => onChange({ ...condition, value })}
        placeholder={m.workbench_match_value_empty()}
        options={options.map(([value, label]) => ({ value, label }))}
      />
    );
  }
  if (field.type === "number" || field.type === "date")
    return (
      <>
        <input
          data-part="input"
          className={matchInput}
          type={field.type}
          {...valueName.attrs}
          placeholder={m.workbench_match_value_empty()}
          value={condition.value}
          onInput={(event) =>
            onChange({ ...condition, value: event.currentTarget.value })
          }
        />
        {valueName.hiddenName}
      </>
    );
  return (
    <>
      <MatchInput
        data-part="input"
        className={matchInput}
        {...valueName.attrs}
        placeholder={placeholder}
        suggestions={suggestions}
        value={condition.value}
        onChange={(value) => onChange({ ...condition, value })}
      />
      {valueName.hiddenName}
    </>
  );
}

const FIELD_ICONS: Record<FilterField["type"], IconName> = {
  text: "text",
  list: "list",
  collection: "list",
  choice: "text",
  number: "binary",
  date: "calendar",
  boolean: "check-square",
};

function FieldIcon({ field }: { field: FilterField }) {
  return (
    <Icon name={field.kind === "tags" ? "tags" : FIELD_ICONS[field.type]} />
  );
}

function kindLabel(kind: FilterFieldKind): string {
  if (isDatasetFieldKind(kind)) return kind.slice("field:".length);
  return kind.startsWith("custom:")
    ? kind.slice("custom:".length)
    : KIND_LABELS[kind as NamedFilterFieldKind]();
}

export function filterVocabulary(
  dataset: FilterDataset,
  {
    values,
    issue,
    fault,
    label,
    icon,
    extra = [],
  }: {
    values: FilterValues;
    issue?: (
      condition: RowCondition<FilterRow>,
      path: readonly number[],
    ) => string | null;
    fault?: MatchVocabulary<FilterRow>["fault"];
    label?: (field: FilterField) => string | null | undefined;
    icon?: (field: FilterField) => ReactNode;
    extra?: readonly FilterField[];
  },
): MatchVocabulary<FilterRow> {
  const fields = [...filterFields(dataset), ...extra];
  let last: { text: string; row: FilterRow | null } | undefined;
  const parsed = (text: string) => {
    if (last?.text !== text) last = { text, row: parseFilterRow(text, fields) };
    return last.row;
  };
  const kinds = fields.map((field): MatchConditionKind<FilterRow> => ({
    kind: field.kind,
    label: label?.(field) ?? field.label ?? kindLabel(field.kind),
    icon: icon ? icon(field) : <FieldIcon field={field} />,
    detail: field.path,
    ...(field.searchTerms && { searchTerms: field.searchTerms }),
    fresh: () => freshFilterRow(field),
    parse: (text) => {
      const row = parsed(text);
      return row?.kind === field.kind ? row : null;
    },
    format: (row) => formatFilterRow(row, fields),
    renderOperator: ({ condition, onChange }) => (
      <RowOperator field={field} condition={condition} onChange={onChange} />
    ),
    renderValue: ({ condition, onChange }) => (
      <RowValue
        field={field}
        condition={condition}
        values={values}
        onChange={onChange}
      />
    ),
  }));
  const first = fields[0]!.kind;
  return {
    kinds,
    newKind: first,
    ...(issue ? { issue } : {}),
    ...(fault ? { fault } : {}),
  };
}
