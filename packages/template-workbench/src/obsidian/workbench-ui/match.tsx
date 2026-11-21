import type { WorkbenchDocumentController } from "#core/document/controller.ts";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";

import { composeFilterTree } from "@zotlit/filter-expression";
import type { FilterPath } from "@zotlit/filter-expression";
import { ITEMS } from "@zotlit/item-query";
import { iconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import type { MatchTree } from "@zotlit/templates/facade";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import { useCustomFieldNames } from "./custom-fields.ts";
import { useWorkbenchModel } from "./editor.tsx";
import { ExampleActions } from "./example-state.tsx";
import { schemaLocale } from "./explorer-sections.ts";
import type { WorkbenchMatchResult } from "./host.tsx";
import { workbenchRows, templateWorkbenchButton } from "./look.ts";
import {
  appendAt,
  asExpression,
  asLabelled,
  freshGroup,
  freshRow,
  fitsVocabulary,
  fromFilter,
  isExpression,
  isGroup,
  moveAt,
  placeholderRow,
  removeAt,
  replaceAt,
  placeKey,
  settle,
  storedFilter,
  storesFilter,
  updateGroup,
} from "./match.draft.ts";
import type {
  ConditionGroup,
  ConditionPath,
  LabelledRow,
  MatchFilter,
  MatchVocabulary,
  RowCondition,
} from "./match.draft.ts";
import { MatchExpressionInput } from "./match.expression.tsx";
import { filterVocabulary } from "./match.fields.tsx";
import type { FilterValues } from "./match.fields.tsx";
import {
  matchPredicate,
  MatchLookContext,
  useMatchLook,
} from "./match.look.ts";
import type { MatchLook } from "./match.look.ts";
import { MatchSelect } from "./match.rows.tsx";
// One Match tree over the document controller; rows write through the master history.
import { useReorder } from "./reorder.ts";
import type { Reorder } from "./reorder.ts";
import { TabDocsLink } from "./tab-bar.tsx";

import { isDatasetFieldKind } from "#core/filter-fields/fields.ts";
import { datasetVocabulary } from "#core/language/expression-vocabulary.ts";

const matchPane = cn(
  "zt:flex zt:min-w-0 zt:flex-col zt:gap-4 zt:text-sm",
  "zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:var(--icon-s-stroke-width)]",
  "zt:[&>p]:text-xs zt:[&>p]:leading-normal zt:[&>p]:text-pretty zt:[&>p]:text-muted-foreground",
);
const matchActions = "zt:flex zt:flex-wrap zt:items-center zt:gap-2";
const matchGroup = cn(
  "zt:flex zt:w-full zt:min-w-0 zt:flex-1 zt:flex-col zt:gap-2 zt:data-[state=nested]:rounded-md zt:data-[state=nested]:border zt:data-[state=nested]:border-border zt:data-[state=nested]:bg-card zt:data-[state=nested]:p-2 zt:[&>[data-part=actions]:first-child]:justify-between",
  workbenchRows.group(),
);
const matchIconButton = iconButton({
  className:
    "zt:shrink-0 zt:aria-disabled:cursor-default zt:aria-disabled:opacity-50",
});
const matchRow = workbenchRows.row();
const matchHandle = workbenchRows.handle();
const matchConjunction =
  "zt:flex zt:min-h-(--input-height) zt:items-center zt:justify-end zt:text-end zt:text-sm zt:text-muted-foreground zt:[overflow-wrap:anywhere]";
const matchButton = templateWorkbenchButton;
const matchStatement = cn(
  "zt:flex zt:min-w-0 zt:items-start zt:overflow-hidden zt:rounded-md zt:bg-input zt:ring-1 zt:ring-border-hover zt:focus-within:ring-2 zt:focus-within:ring-border-focus",
  "zt:[--dropdown-background-hover:var(--background-modifier-form-field-hover)] zt:[--dropdown-background:var(--background-modifier-form-field)] zt:[--input-border-width-focus:0px] zt:[--input-border-width:0px] zt:[--input-radius:0px] zt:[--input-shadow:none]",
  "zt:[&_[data-part=wrapper]>select]:[field-sizing:content] zt:[&_[data-part=wrapper]>select]:w-full zt:[&:has([aria-invalid=true])]:ring-(--background-modifier-error)",
  "zt:[&>[data-part=actions]]:h-(--input-height) zt:[&>[data-part=actions]]:shrink-0 zt:[&>[data-part=actions]]:flex-nowrap zt:[&>[data-part=actions]]:gap-0 zt:[&>[data-part=actions]]:px-0.5",
);
// A condition's layout: the kind's Select keeps its whole name, and the
// value is what yields. The value stays beside the predicate while its
// narrowest form fits there (its widest chip or word, an input's
// width), and otherwise takes a line of its own; it grows into what is
// left either way. Only a predicate wider than the whole line shrinks,
// and then the operator gives up width before the kind's name does.
const matchFields =
  "zt:flex zt:min-w-0 zt:flex-1 zt:flex-wrap zt:items-stretch zt:overflow-hidden";
const matchValue = cn(
  "zt:-ms-px zt:-mt-px zt:flex zt:max-w-full zt:min-w-0 zt:grow zt:basis-[min-content] zt:items-start zt:border-s zt:border-t zt:border-border zt:empty:hidden",
  "zt:[&>:is([data-part=input],div[data-part=control])]:w-[12ch] zt:[&>:not([data-part=actions],datalist)]:flex-auto",
);

export type {
  LabelledRow,
  MatchFilter,
  MatchVocabulary,
} from "./match.draft.ts";

const NO_VALUES: FilterValues = { tags: [], collections: [], libraries: [] };

/** What a Match test reads while there is no Item or no filter to test. */
const NO_TEST = Atom.make(
  AsyncResult.initial<WorkbenchMatchResult | "failed", unknown>(),
);

/**
 * The Match of the open Profile document: the Match editor with the
 * conditions of the Items dataset, and whether the example Item matches, as
 * the host tests it.
 */
export function MatchPane({
  controller,
  vocabularyRevision,
  exampleMessage,
  onRetry,
  onChooseItem,
}: {
  controller: WorkbenchDocumentController;
  /** Changes when the host has a new snapshot or database vocabulary. */
  vocabularyRevision?: string | number;
  exampleMessage?: string | null;
  onRetry?: () => void;
  onChooseItem?: () => void;
}) {
  const model = useWorkbenchModel();
  const item = useAtomValue(model.item);
  useAtomValue(model.document.revision);
  const readable = controller.document !== null;
  // The last filter that parsed, which stands while the draft does not.
  const match = useAtomValue(model.match);
  const [writeProblem, setWriteProblem] = useState<string | null>(null);
  const retry = useAtomSet(model.matchRetry);
  const revision = String(vocabularyRevision ?? "");
  const vocabularyResult = useAtomValue(model.matchVocabulary(revision));
  const loading =
    AsyncResult.isInitial(vocabularyResult) || vocabularyResult.waiting;
  const values = AsyncResult.isSuccess(vocabularyResult)
    ? vocabularyResult.value
    : NO_VALUES;
  const problem = AsyncResult.isFailure(vocabularyResult)
    ? m.workbench_example_failed()
    : null;
  const filter = useMemo(
    () => (match === undefined ? null : composeFilterTree(match)),
    [match],
  );
  const test = useMatchTest(item?.id ?? null, filter?.text ?? null, revision);
  const answer = typeof test === "object" ? test : null;
  // A mistake shows on the condition it is in, where it has a place.
  const span = answer?.kind === "problem" ? answer.span : undefined;
  const faulty = span
    ? filter?.leaves.find(({ from, to }) => span.from >= from && span.to <= to)
    : undefined;
  // The test's Fault, in the text of the condition it is in.
  const placed = useMemo(
    () =>
      filter && faulty && span
        ? {
            path: faulty.path,
            fault: {
              text: filter.text.slice(faulty.from, faulty.to),
              span: {
                from: span.from - faulty.from,
                to: span.to - faulty.from,
              },
            },
          }
        : null,
    [filter, faulty, span],
  );
  const locale = runtime.getLocale();
  const custom = useCustomFieldNames(revision);
  // What a condition reads: the fields of an Item, labelled as Zotero labels
  // them, and the source's custom fields. A Profile binds no Query Context,
  // has no Formulas and reads no vault property.
  const schema = schemaLocale(locale);
  const expression = useMemo(() => {
    const labels = FIELD_LABELS[schema];
    return datasetVocabulary(ITEMS, {
      label: (path) => labels[path],
      custom,
    });
  }, [schema, custom]);
  const vocabulary = useMemo(
    () => ({
      ...filterVocabulary("items", {
        values,
        label: (field) =>
          isDatasetFieldKind(field.kind)
            ? FIELD_LABELS[schema][field.path]
            : undefined,
        issue: (_, path) =>
          faulty &&
          answer?.kind === "problem" &&
          placeKey(path) === placeKey(faulty.path)
            ? answer.message
            : null,
        fault: (path) =>
          placed && placeKey(path) === placeKey(placed.path)
            ? placed.fault
            : undefined,
      }),
      expression,
    }),
    [values, schema, faulty, answer, placed, expression],
  );
  function write(next: MatchTree | undefined) {
    const saved = controller.setMatch(next);
    setWriteProblem(saved ? null : m.workbench_match_source_only());
    return saved;
  }
  const reason =
    controller.document?.manifest.id === "default"
      ? m.workbench_match_default()
      : !readable
        ? m.workbench_match_source_only()
        : test === "failed"
          ? m.workbench_example_failed()
          : answer?.kind === "missing"
            ? m.workbench_match_missing_facts()
            : answer?.kind === "unavailable"
              ? m.workbench_match_example_unavailable()
              : answer?.kind === "problem" && !faulty
                ? answer.message
                : null;
  const matched = answer?.kind === "result" && answer.matched;
  const pending = filter !== null && test === undefined;
  const failed = problem ?? reason;
  const resultMessage = !item
    ? m.workbench_match_choose_item()
    : (exampleMessage ??
      (loading || pending ? m.workbench_loading_item() : null) ??
      (failed
        ? m.workbench_match_result_unavailable({ reason: failed })
        : matched
          ? m.workbench_match_result_yes()
          : m.workbench_match_result_no()));
  const resultState = !item
    ? "no-selection"
    : onRetry || (!loading && failed)
      ? "error"
      : exampleMessage || loading || pending
        ? "loading"
        : matched
          ? "match"
          : "no-match";
  return (
    <section
      data-part="pane"
      className={matchPane}
      onKeyDown={(event) => {
        // A popup the host draws in the pane, such as a select's search
        // field, keeps its own text editing by stopping the key at its edge.
        // A field with a history of its own, such as the expression field's
        // CodeMirror, takes the key as it undoes, and the pane leaves it:
        // stepping the Match too would put back the text the field undid.
        if (event.defaultPrevented) return;
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
        if (
          event.key.toLowerCase() === "z" ||
          event.key.toLowerCase() === "y"
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey || event.key.toLowerCase() === "y")
            controller.redo();
          else controller.undo();
        }
      }}
    >
      <p>
        {m.workbench_match_conditions_desc()} <TabDocsLink tab="match" />
      </p>
      <MatchEditor
        value={match}
        vocabulary={vocabulary}
        onChange={write}
        disabled={
          controller.readOnly ||
          !readable ||
          controller.document?.manifest.id === "default"
        }
      />
      <div data-part="actions" className={matchActions}>
        <p
          role="status"
          data-part="result"
          data-state={resultState}
          className="zt:text-xs zt:leading-normal zt:text-muted-foreground"
        >
          {resultMessage}
        </p>
        <ExampleActions
          chooseLabel={m.workbench_choose_match_item()}
          onChooseItem={onChooseItem}
          onRetry={
            onRetry ??
            (problem || test === "failed"
              ? () => retry((value) => value + 1)
              : undefined)
          }
        />
      </div>
      {writeProblem && <p role="alert">{writeProblem}</p>}
    </section>
  );
}

/**
 * The host's test of the Item `indexedKey` against `filter`: `undefined`
 * while it runs, and `failed` when the host could not answer, by a failure
 * or a defect. A filter or an
 * Item of `null` is not tested. A new `revision` tests again.
 */
function useMatchTest(
  indexedKey: string | null,
  filter: string | null,
  revision: string,
): WorkbenchMatchResult | "failed" | undefined {
  const model = useWorkbenchModel();
  const answer = useAtomValue(
    indexedKey === null || filter === null
      ? NO_TEST
      : model.matchTest(JSON.stringify([indexedKey, filter, revision])),
  );
  return AsyncResult.isSuccess(answer) ? answer.value : undefined;
}

/**
 * A Match tree as "All" / "Any" / "None of the following are true" groups of
 * condition rows. The caller owns the stored filter and the conditions it
 * offers; `onChange` answers whether the caller kept the new filter, and a
 * kept filter comes back as `value` in the render the change causes. A
 * `value` the rows on screen do not store replaces them.
 */
const NO_LOOK: MatchLook = {};

export function MatchEditor<Row extends LabelledRow>({
  value,
  onChange,
  vocabulary,
  disabled = false,
  look = NO_LOOK,
}: {
  value: MatchFilter | undefined;
  /** `undefined` when the author clears every condition. */
  onChange: (next: MatchTree | undefined) => boolean;
  vocabulary: MatchVocabulary<Row>;
  disabled?: boolean;
  /** The classes of the parts this surface draws in a look of its own. */
  look?: MatchLook;
}) {
  const [root, setRootState] = useState<ConditionGroup<Row>>(() =>
    fromFilter(value, vocabulary),
  );
  // The tree as last shown: a value it already stores is the editor's own
  // edit coming back, so an expression row the author is typing stays one.
  const shown = useRef(root);
  function setRoot(next: ConditionGroup<Row>) {
    shown.current = next;
    setRootState(next);
  }
  const latest = useRef(vocabulary);
  latest.current = vocabulary;
  // Read as the caller's render commits, before the next key: an effect
  // waits for paint, and the author may type again before it runs, so the
  // caller's echo of the editor's own edit would read as an older filter
  // than the tree on screen and rebuild the rows under the caret.
  useLayoutEffect(() => {
    if (
      fitsVocabulary(shown.current, latest.current) &&
      storesFilter(shown.current, value, latest.current)
    )
      return;
    setRoot(fromFilter(value, latest.current));
  }, [value]);
  // A new vocabulary — a view's dataset changed — may not offer the kinds
  // of the rows on screen; the stored filter then reads again under it.
  const fits = fitsVocabulary(root, vocabulary);
  const tree = fits ? root : fromFilter(value, vocabulary);
  useEffect(() => {
    if (!fits) setRoot(tree);
  });
  // A change that stores what the caller holds — a placeholder row, a row
  // with no value yet — stays on screen without a write.
  function change(next: ConditionGroup<Row>) {
    const settled = settle(next, vocabulary);
    setRoot(settled);
    const { filter } = storedFilter(settled, vocabulary);
    if (JSON.stringify(filter) === JSON.stringify(value)) return;
    if (!onChange(filter)) setRoot(fromFilter(value, vocabulary));
  }
  const { places } = storedFilter(tree, vocabulary);
  const reorder = useReorder({
    disabled,
    onMove: (from, to) => {
      const next = moveAt(tree, from, to);
      if (next === tree) return false;
      change(next);
      return true;
    },
  });
  return (
    <MatchLookContext value={look}>
      <fieldset
        disabled={disabled}
        data-part="fieldset"
        className={
          look.fieldset ??
          "zt:flex zt:min-w-0 zt:flex-col zt:items-start zt:gap-4 zt:border-0 zt:p-0"
        }
        {...reorder.list}
      >
        <Group
          root={tree}
          group={tree}
          path={[]}
          places={places}
          vocabulary={vocabulary}
          reorder={reorder}
          onChange={change}
        />
      </fieldset>
    </MatchLookContext>
  );
}

function Group<Row extends LabelledRow>({
  root,
  group,
  path,
  places,
  vocabulary,
  reorder,
  onChange,
}: {
  root: ConditionGroup<Row>;
  group: ConditionGroup<Row>;
  path: ConditionPath;
  /** Where each row sits in the stored filter, as {@link storedFilter} finds it. */
  places: ReadonlyMap<string, FilterPath>;
  vocabulary: MatchVocabulary<Row>;
  reorder: Reorder;
  onChange: (root: ConditionGroup<Row>) => void;
}) {
  const look = useMatchLook();
  // "Add condition" hands the focus to the new row's condition type.
  const rows = useRef<HTMLUListElement>(null);
  const focusAdded = useRef(false);
  useEffect(() => {
    if (!focusAdded.current) return;
    focusAdded.current = false;
    rows.current
      ?.querySelector<HTMLElement>(
        // The kind picker is a native select, or the host's own trigger.
        ":scope > li:last-child [data-condition-row] :is(select, button[aria-label])",
      )
      ?.focus();
  }, [group.conditions.length]);
  return (
    <div
      data-part="group"
      data-state={path.length ? "nested" : "root"}
      className={look("group", matchGroup)}
      {...reorder.group(path, group.conditions.length)}
    >
      <div
        data-part="actions"
        data-state={"header"}
        className={look("actions", matchActions)}
        {...reorder.header(path)}
      >
        <MatchSelect
          aria-label={m.workbench_match_match()}
          value={group.match}
          onChange={(value) =>
            onChange(
              updateGroup(root, path, (node) => ({
                ...node,
                match:
                  value === "any" ? "any" : value === "none" ? "none" : "all",
              })),
            )
          }
          options={[
            { value: "all", label: m.workbench_match_match_all() },
            { value: "any", label: m.workbench_match_match_any() },
            { value: "none", label: m.workbench_match_match_none() },
          ]}
        />
        {path.length > 0 && (
          <button
            data-part="icon-button"
            className={matchIconButton}
            type="button"
            {...tooltipAttrs(m.workbench_match_remove_group())}
            onClick={() => onChange(removeAt(root, path))}
          >
            <Icon name="trash-2" />
          </button>
        )}
      </div>
      <ul
        ref={rows}
        data-part="rows"
        className={look(
          "rows",
          "zt:flex zt:flex-col zt:gap-2 zt:list-none zt:m-0 zt:p-0",
        )}
        {...reorder.rows(path)}
      >
        {group.conditions.map((node, index) => (
          <li
            key={index}
            data-part="row"
            data-state={isGroup(node) ? "group" : "condition"}
            className={look("row", matchRow)}
            {...reorder.row([...path, index], group.conditions.length)}
          >
            <span
              data-part="handle"
              className={look("handle", matchHandle)}
              {...tooltipAttrs(m.workbench_drag_to_reorder())}
              {...reorder.handle([...path, index], group.conditions.length)}
            >
              <Icon name="grip-vertical" />
            </span>
            {!isGroup(node) && (
              <span
                data-part="conjunction"
                className={look("conjunction", matchConjunction)}
              >
                {index === 0
                  ? m.workbench_match_conjunction_where()
                  : group.match === "all"
                    ? m.workbench_match_conjunction_and()
                    : m.workbench_match_conjunction_or()}
              </span>
            )}
            {isGroup(node) ? (
              <Group
                root={root}
                group={node}
                path={[...path, index]}
                places={places}
                vocabulary={vocabulary}
                reorder={reorder}
                onChange={onChange}
              />
            ) : (
              <Row
                condition={node}
                stored={places.get(placeKey([...path, index])) ?? null}
                vocabulary={vocabulary}
                onChange={(next) =>
                  onChange(replaceAt(root, [...path, index], next))
                }
                onRemove={() => onChange(removeAt(root, [...path, index]))}
              />
            )}
          </li>
        ))}
      </ul>
      <div
        data-part="actions"
        data-state={"footer"}
        className={look("actions", matchActions)}
      >
        <button
          data-part="button"
          className={look("button", matchButton)}
          type="button"
          onClick={() => {
            focusAdded.current = true;
            onChange(appendAt(root, path, placeholderRow(vocabulary)));
          }}
        >
          <Icon name="plus" />
          {m.workbench_match_add_condition()}
        </button>
        <button
          data-part="button"
          className={look("button", matchButton)}
          type="button"
          onClick={() => onChange(appendAt(root, path, freshGroup(vocabulary)))}
        >
          <Icon name="plus" />
          {m.workbench_match_add_group()}
        </button>
      </div>
    </div>
  );
}

function Row<Row extends LabelledRow>({
  condition,
  stored,
  vocabulary,
  onChange,
  onRemove,
}: {
  condition: RowCondition<Row>;
  /** The row's place in the stored filter; `null` while it stores nothing. */
  stored: FilterPath | null;
  vocabulary: MatchVocabulary<Row>;
  onChange: (condition: RowCondition<Row>) => void;
  onRemove: () => void;
}) {
  const look = useMatchLook();
  const issue =
    stored === null ? null : (vocabulary.issue?.(condition, stored) ?? null);
  const place = stored === null ? null : placeKey(stored);
  const findFault = vocabulary.fault;
  const fault = useMemo(
    () => (stored === null ? undefined : findFault?.(stored)),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `place` stands for `stored`, a new array on each render
    [findFault, place],
  );
  // A blank expression stores nothing, as a placeholder row does.
  const labelled = isExpression(condition)
    ? condition.text.trim() === ""
      ? placeholderRow(vocabulary)
      : asLabelled(condition, vocabulary)
    : null;
  const editVisually =
    labelled === null
      ? m.workbench_match_edit_visually_unavailable()
      : m.workbench_match_edit_visually();
  const kind = isExpression(condition)
    ? undefined
    : vocabulary.kinds.find((entry) => entry.kind === condition.kind);
  return (
    <div
      data-part="condition"
      className="zt:col-start-3 zt:min-w-0"
      data-condition-row=""
    >
      <div
        data-part="statement"
        data-state={issue ? "error" : undefined}
        className={look("statement", matchStatement)}
      >
        <div data-part="fields" className={matchFields}>
          {!isExpression(condition) && (
            <div
              data-part="predicate"
              data-state={kind?.icon ? "icon" : undefined}
              className={look("predicate", matchPredicate)}
            >
              <MatchSelect
                searchable
                aria-label={m.workbench_match_condition_kind()}
                value={condition.kind}
                options={vocabulary.kinds.map((entry) => ({
                  value: entry.kind,
                  label: entry.label,
                  icon: entry.icon,
                  detail: entry.detail,
                  searchTerms: entry.searchTerms,
                }))}
                onChange={(next) =>
                  onChange(freshRow(vocabulary, next as Row["kind"]))
                }
              />
              {kind?.renderOperator?.({ condition, onChange })}
            </div>
          )}
          <div data-part="value" className={matchValue}>
            {isExpression(condition) ? (
              <MatchExpressionInput
                aria-label={m.workbench_match_expression()}
                aria-invalid={issue !== null}
                placeholder={m.workbench_match_expression_placeholder()}
                value={condition.text}
                vocabulary={vocabulary.expression}
                fault={fault}
                onChange={(text) => onChange({ kind: "expression", text })}
              />
            ) : (
              kind?.renderValue({ condition, onChange })
            )}
          </div>
        </div>
        <div data-part="actions" className={look("actions", matchActions)}>
          {isExpression(condition) ? (
            <button
              data-part="icon-button"
              className={matchIconButton}
              type="button"
              // Stays hoverable and focusable, so its tooltip gives the reason.
              aria-disabled={labelled === null || undefined}
              {...tooltipAttrs(editVisually)}
              onClick={() => {
                if (labelled) onChange(labelled);
              }}
            >
              <Icon name="sliders-horizontal" />
            </button>
          ) : (
            <button
              data-part="icon-button"
              className={matchIconButton}
              type="button"
              {...tooltipAttrs(m.workbench_match_edit_as_expression())}
              onClick={() => onChange(asExpression(condition, vocabulary))}
            >
              <Icon name="code" />
            </button>
          )}
          <button
            data-part="icon-button"
            className={matchIconButton}
            type="button"
            {...tooltipAttrs(m.workbench_match_remove_condition())}
            onClick={onRemove}
          >
            <Icon name="trash-2" />
          </button>
        </div>
      </div>
      {issue && (
        <p
          role="alert"
          data-part="error"
          className={look(
            "error",
            "zt:pt-1 zt:text-xs zt:leading-normal zt:text-pretty zt:text-(--text-error)",
          )}
        >
          {issue}
        </p>
      )}
    </div>
  );
}
