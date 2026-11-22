import type {
  ConditionIssue,
  FilterSection,
  QueryFileDataset,
} from "#core/query-view/query-file.ts";
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { foldFilterTree } from "@zotlit/filter-expression";
import { useObsidianApp } from "@zotlit/obsidian-kit/app-context.ts";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import type { ViewRun } from "@zotlit/obsidian-kit/view-runner.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ExpressionVocabulary } from "@zotlit/template-workbench/core/language/index.ts";
import {
  createTemplateWorkbenchHost,
  refuseRender,
} from "@zotlit/template-workbench/obsidian/editor/host.tsx";
import {
  MatchEditor,
  WorkbenchHostProvider,
  filterVocabulary,
  isDatasetFieldKind,
  NO_MATCH_DATA,
} from "@zotlit/template-workbench/obsidian/workbench-ui/index.tsx";
import type {
  FilterField,
  FilterValues,
  MatchFilter,
  MatchLook,
} from "@zotlit/template-workbench/obsidian/workbench-ui/index.tsx";
import { matchRows } from "@zotlit/template-workbench/obsidian/workbench-ui/look.ts";
import { matchPredicate } from "@zotlit/template-workbench/obsidian/workbench-ui/match.look.ts";
import type { MatchTree } from "@zotlit/templates/facade";

import { filterValuesAtom } from "./atoms.ts";
import {
  expressionVocabulary,
  useFilterExpressions,
} from "./expression-vocabulary.ts";
import { useQueryViewState } from "./model.ts";
import { propertyIcon } from "./property-icon.ts";
import type { LiteratureNotes, VaultPropertyType } from "./table-notes.ts";
import { useVaultPropertyNames, useVaultVersion } from "./vault-cell.tsx";
import { fieldLabel, useViewProperties } from "./view-properties.ts";
import type { ViewProperties } from "./view-properties.ts";
import type { QueryView } from "./view.tsx";

import { allViewsDataset, vaultProperty } from "#core/query-view/query-file.ts";
import { toolbarButtonLook } from "#obsidian/query-view/toolbar-button.tsx";
import {
  PopoverHeader,
  PopoverSection,
  ToolbarPopover,
} from "#obsidian/query-view/toolbar-popover.tsx";

export type { FilterValues };

const NO_VALUES: FilterValues = { tags: [], collections: [], libraries: [] };
const noValuesAtom = Atom.make(AsyncResult.success(NO_VALUES));

export type FilterIssue = ConditionIssue | null;

const VAULT_FIELD_TYPES: Record<VaultPropertyType, FilterField["type"]> = {
  text: "text",
  multitext: "list",
  number: "number",
  checkbox: "boolean",
  date: "text",
  datetime: "text",
  tags: "list",
  aliases: "list",
};

const VAULT_KIND_PREFIX = "custom:";

export function vaultFilterFields(
  names: readonly string[],
  notes: Pick<LiteratureNotes, "propertyType">,
  properties: ViewProperties | null,
): FilterField[] {
  return names.map((name) => {
    const property = vaultProperty(name);
    return {
      kind: `${VAULT_KIND_PREFIX}${property}`,
      path: `vault[${JSON.stringify(name)}]`,
      type: VAULT_FIELD_TYPES[notes.propertyType(name)],
      label: properties?.entry(property).label ?? fieldLabel(property),
    };
  });
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, at) => value === b[at]);
}

const filterRows = matchRows({ look: "filter" });
const filterLook: MatchLook = {
  button: cn("zt-query-popover-action", toolbarButtonLook),
  fieldset: cn(
    "zt:m-0 zt:flex zt:min-w-0 zt:flex-col zt:border-0 zt:p-0 zt:text-sm",
    "zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:var(--icon-s-stroke-width)]",
  ),
  group: cn(
    "zt:flex zt:w-full zt:min-w-0 zt:flex-col zt:gap-(--size-2-3)",
    "zt:data-[state=nested]:rounded-md zt:data-[state=nested]:border-(length:--table-border-width) zt:data-[state=nested]:border-(--table-border-color) zt:data-[state=nested]:bg-(--background-primary-alt) zt:data-[state=nested]:p-(--size-2-3)",
    filterRows.group(),
  ),
  actions: cn(
    "zt:flex zt:flex-wrap zt:items-center",
    "zt:data-[state=header]:justify-between zt:data-[state=header]:gap-(--size-2-1) zt:data-[state=header]:pb-(--size-2-1)",
    "zt:data-[state=header]:[--dropdown-background-hover:var(--background-modifier-hover)] zt:data-[state=header]:[--dropdown-background:transparent] zt:data-[state=header]:[--input-shadow:none]",
    "zt:data-[state=footer]:pt-(--size-2-2)",
  ),
  rows: "zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-(--size-2-3) zt:p-0",
  row: filterRows.row(),
  handle: filterRows.handle(),
  conjunction:
    "zt:flex zt:min-h-(--input-height) zt:items-center zt:justify-end zt:text-end zt:text-sm zt:[overflow-wrap:anywhere]",
  statement: cn(
    "zt:flex zt:min-w-0 zt:items-start zt:overflow-hidden zt:rounded-(--metadata-property-radius) zt:bg-input zt:[corner-shape:var(--metadata-property-corner-shape)]",
    "zt:shadow-[0_0_0_var(--border-width)_var(--background-modifier-border-hover)] zt:focus-within:shadow-(--metadata-property-box-shadow-focus) zt:data-[state=error]:shadow-[0_0_0_var(--border-width)_var(--background-modifier-error)] zt:[&:has([aria-invalid=true])]:shadow-[0_0_0_var(--border-width)_var(--background-modifier-error)]",
    "zt:[--dropdown-background-hover:var(--background-modifier-form-field-hover)] zt:[--dropdown-background:var(--background-modifier-form-field)] zt:[--input-border-width-focus:0px] zt:[--input-border-width:0px] zt:[--input-radius:0px] zt:[--input-shadow:none]",
    "zt:[&_[data-part=wrapper]>select]:[field-sizing:content] zt:[&_[data-part=wrapper]>select]:w-full",
    "zt:[&>[data-part=actions]]:h-(--input-height) zt:[&>[data-part=actions]]:shrink-0 zt:[&>[data-part=actions]]:flex-nowrap zt:[&>[data-part=actions]]:px-(--size-2-1)",
  ),
  predicate: cn(
    matchPredicate,
    "zt:[&>[role=combobox]~[data-part=wrapper]]:border-s-(length:--border-width)",
    "zt:[&>[role=combobox]:first-of-type]:max-w-[14em]",
  ),
  "kind-icon":
    "zt:flex zt:shrink-0 zt:items-center zt:self-stretch zt:ps-(--size-4-2) zt:text-(--icon-color)",
  error:
    "zt:pt-(--size-4-1) zt:text-xs zt:leading-normal zt:text-pretty zt:text-(--text-error)",
};

export interface FilterEditorProps {
  run: ViewRun;
  dataset: QueryFileDataset;
  allViewsDataset: QueryFileDataset;
  allViews: MatchFilter | undefined;
  thisView: MatchFilter | undefined;
  values: FilterValues;
  issue: FilterIssue;
  properties: ViewProperties | null;
  sections?: readonly FilterSection[];
  vaultFields?: readonly FilterField[];
  vaultType?: (name: string) => VaultPropertyType;
  expressions?: (dataset: QueryFileDataset) => ExpressionVocabulary;
  onChange: (section: FilterSection, next: MatchTree | undefined) => boolean;
}

export function FilterEditor({
  run,
  dataset,
  allViewsDataset: shared,
  allViews,
  thisView,
  values,
  issue,
  properties,
  sections: shown = ["all", "view"],
  vaultFields = [],
  vaultType,
  expressions = (of) => expressionVocabulary({ dataset: of, properties }),
  onChange,
}: FilterEditorProps) {
  const app = useObsidianApp();
  const host = useMemo(() => {
    const created = createTemplateWorkbenchHost(app, {
      run,
      render: refuseRender("The Query View filter renders no template."),
      matchData: NO_MATCH_DATA,
      insertTarget: () => null,
    });
    return { ...created, inputSuggestions: undefined };
  }, [app, run]);
  useEffect(() => () => host[Symbol.dispose](), [host]);
  const faultsOf = useMemo(() => {
    const issueAt = (section: FilterSection, path: readonly number[]) =>
      issue && issue.section === section && samePath(issue.path, path)
        ? issue
        : null;
    const of = (section: FilterSection) => (path: readonly number[]) =>
      issueAt(section, path)?.fault;
    return { issueAt, all: of("all"), view: of("view") };
  }, [issue]);
  const vocabulary = (section: FilterSection) => {
    const of = section === "all" ? shared : dataset;
    const conditions = filterVocabulary(of, {
      values,
      issue: (_, path) => faultsOf.issueAt(section, path)?.message ?? null,
      fault: faultsOf[section],
      label: (field) =>
        field.label ??
        properties?.entry(field.path).displayName ??
        (isDatasetFieldKind(field.kind) ? fieldLabel(field.path) : undefined),
      icon: (field) => (
        <Icon
          name={propertyIcon(
            of,
            field.kind.startsWith(VAULT_KIND_PREFIX)
              ? {
                  path: field.kind.slice(VAULT_KIND_PREFIX.length),
                  kind: "vault",
                }
              : { path: field.path, kind: "field" },
            vaultType,
          )}
        />
      ),
      extra: of === "items" ? vaultFields : [],
    });
    return { ...conditions, expression: expressions(of) };
  };
  const sections = (
    [
      ["all", m.query_view_filter_all_views(), allViews],
      ["view", m.query_view_filter_this_view(), thisView],
    ] satisfies [FilterSection, string, MatchFilter | undefined][]
  ).filter(([section]) => shown.includes(section));
  const body = (section: FilterSection, value: MatchFilter | undefined) =>
    section === "all" && shared !== dataset ? (
      <p className="zt:m-0 zt:text-sm zt:text-muted-foreground">
        {m.query_view_filter_other_dataset()}
      </p>
    ) : (
      <MatchEditor
        look={filterLook}
        value={value}
        vocabulary={vocabulary(section)}
        onChange={(next) => onChange(section, next)}
      />
    );
  return (
    <WorkbenchHostProvider host={host}>
      <>
        {sections.length > 1 ? (
          sections.map(([section, heading, value]) => (
            <FoldSection
              key={section}
              section={section}
              heading={heading}
              count={conditionCount(value)}
              initiallyOpen={section === "view" || value !== undefined}
            >
              {body(section, value)}
            </FoldSection>
          ))
        ) : (
          <div className="zt:flex zt:flex-col zt:gap-3">
            {sections.map(([section, , value]) => (
              <section key={section} data-filter-section={section}>
                {body(section, value)}
              </section>
            ))}
          </div>
        )}
      </>
    </WorkbenchHostProvider>
  );
}

function FoldSection({
  section,
  heading,
  count,
  initiallyOpen,
  children,
}: {
  section: FilterSection;
  heading: string;
  count: number;
  initiallyOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <PopoverSection data-filter-section={section}>
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="zt:group/fold"
      >
        <summary className="zt:cursor-(--cursor) zt:list-none zt:rounded-sm zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none zt:[&::-webkit-details-marker]:hidden">
          <PopoverHeader>
            <Icon
              name="right-triangle"
              size="xs"
              className="zt:shrink-0 zt:[rotate:calc(var(--direction)*-90deg)] zt:text-(--nav-collapse-icon-color) zt:transition-[rotate] zt:duration-100 zt:group-open/fold:[rotate:none]"
            />
            <span data-filter-heading="" className="zt:min-w-0 zt:truncate">
              {heading}
            </span>
            {count > 0 && (
              <span
                data-filter-count={count}
                className="zt:rounded-sm zt:bg-muted zt:px-(--size-2-2) zt:py-(--size-2-1) zt:text-xs zt:leading-none zt:text-muted-foreground zt:tabular-nums"
              >
                {count}
              </span>
            )}
          </PopoverHeader>
        </summary>
        <div className="zt:p-(--size-4-2)">{children}</div>
      </details>
    </PopoverSection>
  );
}

function conditionCount(tree: MatchFilter | undefined): number {
  return tree === undefined
    ? 0
    : foldFilterTree(tree, {
        leaf: () => 1,
        group: (_, counts) => counts.reduce((sum, count) => sum + count, 0),
      });
}

export function FilterButton({ view }: { view: QueryView }) {
  const file = useQueryViewState(view, (s) => s.file);
  const shown = useQueryViewState(view, (s) => s.view);
  const filterIssue = useQueryViewState(
    view,
    (s) => s.failure?.filterIssue ?? null,
  );
  const { literatureNotes } = view.tableDeps;
  const names = useVaultPropertyNames(literatureNotes);
  const properties = useViewProperties(view, names);
  const vaultVersion = useVaultVersion(literatureNotes);
  const vaultFields = useMemo(
    () => vaultFilterFields(names, literatureNotes, properties),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `vaultVersion` reads the types again
    [names, literatureNotes, properties, vaultVersion],
  );
  const [open, setOpen] = useState(false);
  const read = useAtomValue(open ? filterValuesAtom : noValuesAtom);
  const values = Option.getOrElse(AsyncResult.value(read), () => NO_VALUES);
  const expressions = useFilterExpressions(view, properties, {
    reading: open,
    vaultNames: names,
  });
  if (!file || !shown) return null;
  return (
    <ToolbarPopover
      icon="list-filter"
      label={m.query_view_filter()}
      active={file.filters !== undefined || shown.filters !== undefined}
      count={conditionCount(file.filters) + conditionCount(shown.filters)}
      hook="filter"
      className="zt:w-[min(--spacing(130),calc(100vw_-_var(--size-4-8)))] zt:max-w-none"
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
    >
      <FilterEditor
        run={view.run}
        dataset={shown.from ?? "annotations"}
        allViewsDataset={allViewsDataset(file)}
        allViews={file.filters}
        thisView={shown.filters}
        values={values}
        issue={filterIssue}
        properties={properties}
        vaultFields={vaultFields}
        vaultType={(name) => literatureNotes.propertyType(name)}
        expressions={expressions}
        onChange={(section, next) => view.document.setFilters(section, next)}
      />
    </ToolbarPopover>
  );
}
