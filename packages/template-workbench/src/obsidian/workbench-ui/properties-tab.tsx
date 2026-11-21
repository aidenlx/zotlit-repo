// The Properties tab: one row per Managed Frontmatter entry, each editing its
// own expression through a slice of the master document, summarised by what
// the row produced; the note preview's own Properties block shows the fold.

import type {
  ManagedEntrySource,
  WorkbenchDocumentController,
  WorkbenchProblem,
  WorkbenchSliceRange,
} from "#core/document/index.ts";
import type {
  RenderDiagnostic,
  RenderedProperty,
} from "#core/render/result.ts";
import { useEffect, useState, useRef, useMemo } from "react";

import { iconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import { ExampleActions, useExampleState } from "./example-state.tsx";
import { useContainerName } from "./host.tsx";
import {
  templateWorkbenchButton,
  editorBox,
  dragRow,
  dragHandle,
} from "./look.ts";
import { diagnosticText, documentDiagnosis, problemText } from "./problems.ts";
import { PropertyList, propertyText } from "./property-list.tsx";
import { indexAfterMove, useListReorder } from "./reorder.ts";
import { WorkbenchSelect, WorkbenchOption } from "./select.tsx";
import { SliceEditor } from "./slice-editor.tsx";
import type { SuggestionSource } from "./slice-editor.tsx";
import { useRetention } from "./visited.ts";

import {
  entryPosition,
  entrySlice,
  sliceShownText,
} from "#core/document/index.ts";

const propertiesEmpty =
  "zt:text-xs zt:leading-normal zt:text-muted-foreground zt:text-pretty";
const propertiesSecondaryAction = templateWorkbenchButton;
const propertiesActions = "zt:flex zt:flex-wrap zt:items-center zt:gap-2";
const propertiesRow = cn(
  "zt:min-w-0 zt:rounded-md zt:border zt:border-border zt:bg-background zt:p-2 zt:[--zt-row-border:1px] zt:[&:hover_[data-part=handle]]:opacity-100",
  dragRow,
);
const propertiesHandle = cn(dragHandle, "zt:self-stretch");
const propertiesLabel =
  "zt:text-xs zt:font-medium zt:data-[state=problem]:text-(--text-error)";
const propertiesRowAction = iconButton();
const propertiesPrimaryAction = templateWorkbenchButton;
const propertiesForm = cn(
  "zt:flex zt:min-w-0 zt:flex-col zt:gap-3",
  "zt:mt-3 zt:px-(--size-2-3)",
);
const propertiesField = cn(
  "zt:flex zt:min-w-0 zt:flex-col zt:gap-1.5",
  "zt:text-xs zt:font-medium",
);
const propertiesHint =
  "zt:text-xs zt:leading-normal zt:text-muted-foreground zt:text-pretty";
const propertiesFieldGroup = "zt:flex zt:min-w-0 zt:flex-col zt:gap-1.5";
const propertiesExpressionHeader = cn(
  "zt:flex zt:flex-wrap zt:items-center zt:gap-2",
  "zt:justify-start",
);
const propertiesConfirm = cn(
  "zt:flex zt:min-w-0 zt:flex-col zt:gap-3",
  "zt:rounded-md zt:bg-card zt:p-3",
);
const propertiesExpression = cn(
  editorBox,
  "zt:flex zt:min-h-28 zt:min-w-0 zt:flex-1 zt:flex-col",
  "zt:data-[state=problem]:border-(--text-error)",
);

const MERGE_LABEL: Record<string, () => string> = {
  replace: m.workbench_properties_merge_replace,
  append: m.workbench_properties_merge_append,
  keep: m.workbench_properties_merge_keep,
};

/** A problem one row carries: the text to show, and the entry it names. */
export interface EntryDiagnostic {
  /** 1-based position of the Managed Frontmatter entry it belongs to. */
  readonly position: number;
  readonly message: string;
}

/**
 * The problems the rows carry: the renderer's own that name an entry, and
 * the manifest errors the parser pinned to one entry.
 */
export function entryDiagnostics(
  diagnostics: readonly RenderDiagnostic[],
  problems: readonly WorkbenchProblem[],
): EntryDiagnostic[] {
  return [
    ...diagnostics.flatMap((diagnostic) =>
      diagnostic.position === undefined
        ? []
        : [
            {
              position: diagnostic.position,
              message: diagnosticText(diagnostic),
            },
          ],
    ),
    ...problems.flatMap((problem) => {
      const position = entryPosition(problem.slice);
      return position === null
        ? []
        : [{ position, message: problemText(problem).message }];
    }),
  ];
}

export interface PropertiesPaneProps {
  controller: WorkbenchDocumentController;
  /** The rows, in list order. */
  entries: readonly ManagedEntrySource[];
  /** What each entry produced on its own, from the current render. */
  properties: readonly RenderedProperty[];
  /** The frontmatter the note gets, which orders a spread's produced names. */
  fold: readonly RenderedProperty[];
  /** Every problem that names a row, from the render and from the parser. */
  diagnostics: readonly EntryDiagnostic[];
  /** The open row's position, or null while every row is folded. */
  selected: number | null;
  onSelect: (position: number | null) => void;
  /** A native host can edit JavaScript in its whole-document editor. */
  onOpenSource?: (range: WorkbenchSliceRange) => void;
  /** Opens Problems at one problem, by its diagnosis id. */
  onShowProblem?: (id: string) => void;
  onChooseItem?: () => void;
  onRetry?: () => void;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  suggest?: SuggestionSource;
}

/** Produced fields under the entry that produced them, for either column. */
function byEntry(
  properties: readonly RenderedProperty[],
): Map<number, readonly RenderedProperty[]> {
  return Map.groupBy(properties, (property) => property.position);
}

/** A static entry shows its own value; a spread shows what it produced. */
function summarize({
  entry,
  produced,
  fold,
}: {
  entry: ManagedEntrySource;
  produced: readonly RenderedProperty[];
  fold: readonly RenderedProperty[];
}): string {
  if (entry.key !== undefined) {
    const property = produced[0];
    if (!property || property.missing) return m.workbench_property_unset();
    return property.value == null
      ? m.workbench_property_empty()
      : propertyText(property.value);
  }
  return produced.length === 0
    ? m.workbench_properties_produced_none()
    : m.workbench_properties_produced({
        count: produced.length,
        names: foldOrder(produced, fold).join(", "),
      });
}

/**
 * A spread's produced names the way the fold placed them, so the row reads in
 * the order the note gets. A name the fold dropped keeps the entry's own order,
 * at the end.
 */
function foldOrder(
  produced: readonly RenderedProperty[],
  fold: readonly RenderedProperty[],
): readonly string[] {
  const place = (key: string) => {
    const index = fold.findIndex((property) => property.key === key);
    return index === -1 ? fold.length : index;
  };
  return produced
    .map((property) => property.key)
    .toSorted((left, right) => place(left) - place(right));
}

export function PropertiesPane({
  controller,
  entries,
  properties,
  fold,
  diagnostics,
  selected,
  onSelect,
  onOpenSource,
  onShowProblem,
  onChooseItem,
  onRetry,
  reveal,
  onSelection,
  suggest,
}: PropertiesPaneProps) {
  const example = useExampleState("properties");
  const exampleMessage = example.message;
  // The output the rows read: this attempt's own, or the output that stands
  // beside the example's condition. Without either, each row shows its rule.
  const standing =
    exampleMessage === null
      ? { properties, fold }
      : example.retained
        ? {
            properties: example.retained.properties,
            fold: example.retained.fold,
          }
        : null;
  const produced = byEntry(standing?.properties ?? []);
  const instanceId = useUniqueId();
  const problems = Map.groupBy(
    diagnostics,
    (diagnostic) => diagnostic.position,
  );
  const [newRow, setNewRow] = useState<number | null>(null);
  // A row the reader has opened stays in the page, hidden, after it closes, so
  // its editor keeps its view rather than rebuilding on every expand. The row
  // is memory of the entry that was there; a list change that puts another
  // entry at the position drops it.
  const entriesByIdentity = useMemo(
    () =>
      new Map(
        entries.map((entry) => [
          entry.position,
          `${entry.key ?? ""}:${entry.language}`,
        ]),
      ),
    [entries],
  );
  const retention = useRetention(entriesByIdentity);
  const openRow =
    selected !== null && entriesByIdentity.has(selected) ? selected : null;
  const { open: openRetained } = retention;
  useEffect(() => {
    if (openRow !== null) openRetained(openRow);
  }, [openRow, openRetained]);
  // A held list stays on screen for repair, but no list change can patch it.
  const locked = controller.readOnly || controller.managedEntriesHeld;

  // The list counts rows from 0; an entry's position counts from 1.
  const reorder = useListReorder({
    disabled: locked,
    onMove: (from, to) => {
      const position = from + 1;
      if (
        !controller.editManagedEntry({ action: "move", position, to: to + 1 })
      )
        return false;
      if (selected !== null) {
        const next = indexAfterMove(selected, position, to + 1);
        if (next !== selected) onSelect(next);
      }
      return true;
    },
  });

  function add(kind: "property" | "spread", after = entries.length) {
    if (controller.editManagedEntry({ action: "add", kind, after })) {
      setNewRow(after + 1);
      onSelect(after + 1);
    }
  }

  return (
    <div data-part="pane" className="zt:flex zt:min-w-0 zt:flex-col zt:gap-3">
      {entries.length === 0 && (
        <p data-part="empty" className={propertiesEmpty}>
          {m.workbench_properties_empty()}
        </p>
      )}
      {controller.managedEntriesHeld && (
        <p
          role="status"
          data-part="empty"
          data-state={"error"}
          className={propertiesEmpty}
        >
          {m.workbench_properties_unparsed()}
          {onShowProblem && controller.problems[0] && (
            <>
              {" "}
              <button
                type="button"
                data-part="secondary-action"
                className={propertiesSecondaryAction}
                onClick={() =>
                  onShowProblem(documentDiagnosis(controller.problems[0]!).id)
                }
              >
                {m.workbench_problem_show()}
              </button>
            </>
          )}
        </p>
      )}
      {(exampleMessage ||
        onChooseItem ||
        (example.kind === "error" && onRetry)) && (
        <div data-part="actions" className={propertiesActions}>
          {exampleMessage && (
            <p
              role="status"
              data-part="empty"
              data-state={example.kind}
              className={propertiesEmpty}
            >
              {exampleMessage}
            </p>
          )}
          <ExampleActions
            chooseLabel={m.workbench_choose_preview_item()}
            onChooseItem={onChooseItem}
            onRetry={example.kind === "error" ? onRetry : undefined}
          />
        </div>
      )}
      <ul
        data-part="rows"
        className="zt:flex zt:min-w-0 zt:flex-col zt:gap-2"
        {...reorder.list}
      >
        {entries.map((entry) => {
          const fields = produced.get(entry.position) ?? [];
          const raised = problems.get(entry.position) ?? [];
          const open = selected === entry.position;
          // A folded row reads what went wrong instead of the value it failed
          // to produce, which is the one place that says so while it is shut.
          // The open row shows it beside the expression it belongs to instead,
          // so the reader is told once either way.
          const failure =
            !open && raised.length > 0 ? raised[0]!.message : null;
          const summary =
            failure ??
            (standing === null
              ? entry.language === "expr"
                ? sliceShownText(controller, entrySlice(entry.position))
                : controller.sliceText(entrySlice(entry.position))
              : summarize({ entry, produced: fields, fold: standing.fold }));
          return (
            <li
              key={entry.position}
              data-part="row"
              className={propertiesRow}
              {...reorder.row(entry.position - 1, entries.length)}
            >
              <div
                data-part="row-header"
                className="zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-1"
              >
                <span
                  data-part="handle"
                  className={propertiesHandle}
                  {...tooltipAttrs(m.workbench_drag_to_reorder())}
                  {...reorder.handle(entry.position - 1, entries.length)}
                >
                  <Icon name="grip-vertical" />
                </span>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`${instanceId}-property-${entry.position}`}
                  onClick={() => onSelect(open ? null : entry.position)}
                  data-part="row-toggle"
                  className={iconButton({
                    className:
                      "zt:min-w-0 zt:flex-1 zt:flex-wrap zt:justify-start zt:gap-x-3 zt:gap-y-1 zt:text-start",
                  })}
                >
                  <span
                    data-part="row-name"
                    className="zt:flex zt:min-w-0 zt:items-center zt:gap-2"
                  >
                    <span
                      data-part="key"
                      className="zt:font-medium zt:text-foreground zt:[overflow-wrap:anywhere]"
                    >
                      {entry.key ?? m.workbench_properties_spread()}
                    </span>
                    {raised.length > 0 && (
                      <span
                        data-part="label"
                        data-state={"problem"}
                        className={propertiesLabel}
                      >
                        {m.workbench_properties_row_problem()}
                      </span>
                    )}
                  </span>
                  {summary && (
                    <span
                      data-part="summary"
                      data-state={
                        failure ? "problem" : open ? "open" : "closed"
                      }
                      className="zt:min-w-0 zt:max-w-full zt:truncate zt:text-xs zt:text-muted-foreground zt:data-[state=problem]:text-(--text-error)"
                      {...tooltipAttrs(summary)}
                    >
                      {standing === null && !failure ? (
                        <code>{summary}</code>
                      ) : (
                        summary
                      )}
                    </span>
                  )}
                </button>
                <div
                  data-part="row-actions"
                  className="zt:ms-auto zt:flex zt:shrink-0 zt:items-center zt:gap-0.5"
                >
                  <button
                    type="button"
                    data-part="edit"
                    className={iconButton()}
                    {...tooltipAttrs(m.workbench_properties_edit())}
                    aria-pressed={open}
                    aria-expanded={open}
                    aria-controls={`${instanceId}-property-${entry.position}`}
                    onClick={() => onSelect(open ? null : entry.position)}
                  >
                    <Icon name={open ? "chevron-down" : "chevron-right"} />
                  </button>
                  <button
                    type="button"
                    data-part="row-action"
                    className={propertiesRowAction}
                    disabled={locked}
                    {...tooltipAttrs(m.workbench_properties_add_override())}
                    onClick={() => add("property", entry.position)}
                  >
                    <Icon name="plus" />
                  </button>
                  <button
                    type="button"
                    data-part="row-action"
                    className={propertiesRowAction}
                    disabled={locked}
                    {...tooltipAttrs(m.workbench_properties_remove())}
                    onClick={() => {
                      if (
                        !controller.editManagedEntry({
                          action: "remove",
                          position: entry.position,
                        })
                      )
                        return;
                      if (open) onSelect(null);
                      else if (selected !== null && selected > entry.position)
                        onSelect(selected - 1);
                    }}
                  >
                    <Icon name="trash-2" />
                  </button>
                </div>
              </div>
              {(open || retention.isRetained(entry.position)) && (
                <EntryForm
                  key={`${entry.position}:${entry.language}`}
                  controller={controller}
                  instanceId={instanceId}
                  entry={entry}
                  produced={fields}
                  showResult={standing !== null}
                  diagnostics={raised}
                  focusName={newRow === entry.position}
                  onOpenSource={onOpenSource}
                  reveal={reveal}
                  onSelection={onSelection}
                  suggest={suggest}
                  hidden={!open}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div data-part="actions" className={propertiesActions}>
        <button
          type="button"
          data-part="primary-action"
          className={propertiesPrimaryAction}
          disabled={locked}
          onClick={() => add("property")}
        >
          <Icon name="plus" />
          {m.workbench_properties_add()}
        </button>
        <button
          type="button"
          data-part="secondary-action"
          className={propertiesSecondaryAction}
          disabled={locked}
          onClick={() => add("spread")}
        >
          <Icon name="plus" />
          {m.workbench_properties_add_spread()}
        </button>
      </div>
    </div>
  );
}

interface EntryFormProps {
  instanceId: string;
  controller: WorkbenchDocumentController;
  entry: ManagedEntrySource;
  produced: readonly RenderedProperty[];
  showResult: boolean;
  diagnostics: readonly EntryDiagnostic[];
  focusName: boolean;
  onOpenSource?: (range: WorkbenchSliceRange) => void;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  suggest?: SuggestionSource;
  /** Whether this form is folded away while the pane keeps its editor alive. */
  hidden?: boolean;
}

/** Edit the name, value, and update behavior of a property. */
function EntryForm({
  instanceId,
  controller,
  entry,
  produced,
  showResult,
  diagnostics,
  focusName,
  onOpenSource,
  reveal,
  onSelection,
  suggest,
  hidden = false,
}: EntryFormProps) {
  // Named as the expression editor is, by a hidden element: no tooltip.
  const textName = useContainerName(m.workbench_properties_expression());
  const [pendingLanguage, setPendingLanguage] = useState<
    "text" | "expr" | "value" | null
  >(null);
  const authored =
    controller.document?.manifest.frontmatter?.[entry.position - 1];
  const fixedText =
    authored && "value" in authored && typeof authored.value === "string"
      ? authored.value
      : null;
  const format =
    entry.language === "value" && fixedText !== null ? "text" : entry.language;
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusName) nameInput.current?.focus();
  }, [focusName]);
  const [name, setName] = useState(entry.key ?? "");
  useEffect(() => setName(entry.key ?? ""), [entry.key]);
  const spread = entry.key === undefined;
  const locked = controller.readOnly || controller.managedEntriesHeld;
  const errorId = `${instanceId}-property-${entry.position}-errors`;
  return (
    <div
      id={`${instanceId}-property-${entry.position}`}
      hidden={hidden}
      data-part="form"
      className={propertiesForm}
    >
      {entry.key !== undefined && (
        <label data-part="field" className={propertiesField}>
          {m.workbench_properties_name()}
          <input
            type="text"
            readOnly={locked}
            ref={nameInput}
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
            onFocus={(event) => {
              if (focusName) event.currentTarget.select();
            }}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (
                value &&
                value !== entry.key &&
                !controller.editManagedEntry({
                  action: "set",
                  position: entry.position,
                  field: "key",
                  value,
                })
              )
                setName(entry.key ?? "");
            }}
            data-part="name-input"
            className="zt:w-full zt:min-w-0 zt:font-normal"
          />
        </label>
      )}
      {entry.language === "js" ? (
        <p data-part="hint" className={propertiesHint}>
          {m.workbench_properties_javascript_source()}
          {onOpenSource && (
            <>
              {" "}
              <button
                type="button"
                data-part="secondary-action"
                className={propertiesSecondaryAction}
                onClick={() => onOpenSource(entry.expression)}
              >
                {m.workbench_advanced()}
              </button>
            </>
          )}
        </p>
      ) : (
        <div data-part="field-group" className={propertiesFieldGroup}>
          <div
            data-part="expression-header"
            className={propertiesExpressionHeader}
          >
            <span data-part="label" className={propertiesLabel}>
              {m.workbench_properties_expression()}
            </span>
            {!spread && (
              <label
                data-part="format-label"
                className="zt:min-w-0 zt:max-w-full"
              >
                <span data-part="hidden-label" className="zt:sr-only">
                  {m.workbench_properties_format()}
                </span>
                <WorkbenchSelect
                  disabled={locked}
                  value={pendingLanguage ?? format}
                  onChange={(next) =>
                    setPendingLanguage(next as "text" | "expr" | "value")
                  }
                >
                  <WorkbenchOption value="text">
                    {m.workbench_properties_format_text()}
                  </WorkbenchOption>
                  <WorkbenchOption value="expr">
                    {m.workbench_properties_format_value()}
                  </WorkbenchOption>
                  <WorkbenchOption value="value">
                    {m.workbench_properties_format_rule()}
                  </WorkbenchOption>
                </WorkbenchSelect>
              </label>
            )}
          </div>
          <p data-part="hint" className={propertiesHint}>
            {format === "text"
              ? m.workbench_properties_text_hint()
              : entry.language === "expr"
                ? m.workbench_properties_value_hint()
                : m.workbench_properties_rule_hint()}
          </p>
          {pendingLanguage && pendingLanguage !== format && (
            <div data-part="confirm" className={propertiesConfirm}>
              <p data-part="text">{m.workbench_properties_format_confirm()}</p>
              <div
                data-part="confirm-actions"
                className="zt:flex zt:flex-wrap zt:items-center zt:gap-2"
              >
                <button
                  type="button"
                  disabled={locked}
                  data-part="primary-action"
                  className={propertiesPrimaryAction}
                  onClick={() => {
                    if (
                      controller.editManagedEntry({
                        action: "language",
                        position: entry.position,
                        language:
                          pendingLanguage === "text"
                            ? "value"
                            : pendingLanguage,
                        ...(pendingLanguage === "text" ? { text: "" } : {}),
                      })
                    )
                      setPendingLanguage(null);
                  }}
                >
                  {m.workbench_properties_format_reset()}
                </button>
                <button
                  type="button"
                  data-part="secondary-action"
                  className={propertiesSecondaryAction}
                  onClick={() => setPendingLanguage(null)}
                >
                  {m.workbench_cancel()}
                </button>
              </div>
            </div>
          )}
          {format === "text" && textName.hiddenName}
          {format === "text" ? (
            <input
              type="text"
              readOnly={controller.readOnly}
              {...textName.attrs}
              value={fixedText ?? ""}
              onInput={(event) =>
                controller.dispatch({
                  changes: {
                    from: entry.expression.from,
                    to: entry.expression.to,
                    insert: JSON.stringify(event.currentTarget.value),
                  },
                  userEvent: "input.type",
                })
              }
              data-part="text-input"
              className="zt:w-full zt:min-w-0 zt:font-normal"
            />
          ) : (
            <div
              data-part="expression"
              data-state={diagnostics.length > 0 ? "problem" : "ok"}
              className={propertiesExpression}
            >
              <SliceEditor
                controller={controller}
                slice={entrySlice(entry.position)}
                label={m.workbench_properties_expression()}
                language={entry.language === "value" ? "json-e" : "expression"}
                invalid={diagnostics.length > 0}
                describedBy={diagnostics.length > 0 ? errorId : undefined}
                visible={!hidden}
                reveal={reveal}
                onSelection={onSelection}
                suggest={suggest}
              />
            </div>
          )}
        </div>
      )}
      {spread && showResult && (
        <PropertyList properties={produced} variant="spread" />
      )}
      {diagnostics.length > 0 && (
        <div
          id={errorId}
          data-part="diagnostics"
          className="zt:text-xs zt:leading-normal zt:text-pretty zt:text-(--text-error)"
        >
          {diagnostics.map((diagnostic, index) => (
            <p key={index} data-part="text">
              {diagnostic.message}
            </p>
          ))}
        </div>
      )}
      <div data-part="field-group" className={propertiesFieldGroup}>
        <label data-part="field" className={propertiesField}>
          {m.workbench_properties_merge()}
          <WorkbenchSelect
            disabled={locked}
            value={entry.merge}
            onChange={(next) =>
              controller.editManagedEntry({
                action: "set",
                position: entry.position,
                field: "merge",
                value: next,
              })
            }
          >
            {Object.entries(MERGE_LABEL).map(([value, label]) => (
              <WorkbenchOption key={value} value={value}>
                {label()}
              </WorkbenchOption>
            ))}
          </WorkbenchSelect>
        </label>
        <p data-part="hint" className={propertiesHint}>
          {m.workbench_properties_override_hint()}
        </p>
      </div>
    </div>
  );
}
