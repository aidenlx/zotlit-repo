import type { DisplayNode, SnippetKind } from "#core/data-tree/index.ts";
import { useLayoutEffect, useRef, useState } from "react";
import type { Ref } from "react";

import { Button } from "@zotlit/obsidian-kit/components/obsidian/button.tsx";
import { iconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
// One field's details in the Fields Panel: its full value, its template path,
// and what the note gets, with Insert and Copy. A wide view shows them in the
// host's popover beside the panel; a narrow one in a bar of fixed height at
// the panel's foot.
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";
import { composing } from "@zotlit/ui";

import { fieldValueText } from "./explorer-fields.ts";
import type { FieldForm, FieldInsertOptions } from "./field-insertion.ts";
import { useFieldsPanelRows } from "./fields-panel.tsx";
import { useWorkbenchHost } from "./host.tsx";
import type { ViewSize } from "./panel-layout.ts";

import { formatPath, isList, listItemValues } from "#core/data-tree/index.ts";

/**
 * A fixed height at the panel's foot, so the list above never moves; in
 * a short panel, no more than half of it, and it gives way to the list
 * first, which keeps one whole row under its sticky section header.
 */
const fieldDetailsDetailsBar =
  "zt:h-48 zt:max-h-1/2 zt:overflow-y-auto zt:border-t zt:border-border zt:bg-(--background-primary)";
const fieldDetailsDetails =
  "zt:flex zt:flex-col zt:gap-3 zt:p-3 zt:text-sm zt:data-[state=bar]:gap-2 zt:data-[state=bar]:p-2 zt:data-[state=popover]:max-h-(--zt-pinned-max-height) zt:data-[state=popover]:w-72 zt:data-[state=popover]:overflow-y-auto zt:data-[state=popover]:rounded-(--radius-m) zt:data-[state=popover]:border zt:data-[state=popover]:border-border zt:data-[state=popover]:bg-(--background-primary) zt:data-[state=popover]:shadow-(--shadow-l)";
/** A list's values, one per line and numbered. */
const fieldDetailsValues =
  "zt:in-data-[state=bar]:order-2 zt:flex zt:max-h-40 zt:flex-col zt:gap-1 zt:overflow-auto zt:rounded-(--radius-s) zt:border zt:border-border zt:p-2 zt:text-green";
const fieldDetailsValue =
  "zt:in-data-[state=bar]:order-2 zt:max-h-40 zt:overflow-auto zt:rounded-(--radius-s) zt:border zt:border-border zt:p-2 zt:whitespace-pre-wrap zt:[overflow-wrap:anywhere] zt:text-green zt:data-[state=empty]:text-muted-foreground zt:data-[state=empty]:italic";
/**
 * The bar shows what the note gets right under its heading, so the
 * snippet stays in view in a short bar; the value and the path follow.
 */
const fieldDetailsItem =
  "zt:flex zt:flex-col zt:gap-0.5 zt:in-data-[state=bar]:data-[state=path]:order-3";
const fieldDetailsLabel = "zt:text-xs zt:text-muted-foreground";
const fieldDetailsResult =
  "zt:flex zt:gap-1.5 zt:whitespace-pre-line zt:[overflow-wrap:anywhere] zt:text-green zt:data-[state=empty]:text-muted-foreground zt:data-[state=empty]:italic";
/** In the bar they stay in view at its foot while the details scroll. */
const fieldDetailsActions =
  "zt:flex zt:flex-wrap zt:gap-2 zt:in-data-[state=bar]:order-4 zt:in-data-[state=bar]:sticky zt:in-data-[state=bar]:bottom-0 zt:in-data-[state=bar]:-mx-2 zt:in-data-[state=bar]:bg-(--background-primary) zt:in-data-[state=bar]:px-2 zt:in-data-[state=bar]:py-2";

/**
 * The narrowest view, in pixels, that shows a field's details in a popover
 * beside the Fields Panel; a narrower view shows them in a bar at the
 * panel's foot.
 */
export const DETAILS_BESIDE_MIN = 600;

/** Where a field's details stand. */
export type FieldDetailsPlacement = "popover" | "bar";

/**
 * Where a field's details stand in a view of `size`: beside the panel in a
 * view {@link DETAILS_BESIDE_MIN} wide or wider, or one not measured yet.
 */
export const placeFieldDetails = (
  size: ViewSize | null,
): FieldDetailsPlacement =>
  size === null || size.width >= DETAILS_BESIDE_MIN ? "popover" : "bar";

/** What the details show and do for one field. */
export interface FieldDetailsContent {
  readonly node: DisplayNode;
  /** The field's name as its row shows it. */
  readonly label: string;
  /** Where the field sits: its section, and the field it belongs to. */
  readonly context: string;
  /** The forms the field goes into the note in; the reader picks one where there are several. */
  readonly forms: readonly FieldForm[];
  /** Absent where the editor takes no field now. */
  readonly onInsert?: (form: FieldForm, options: FieldInsertOptions) => void;
  readonly onCopy: (form: FieldForm) => void;
  readonly onClose: () => void;
  /**
   * Whether the details take focus on their first control as they open: the
   * form choice, else Insert, else Copy. Enter opened them, so the keys
   * reach their controls.
   */
  readonly takeFocus?: boolean;
  /**
   * Tab moved focus past the last control of the details, or Shift+Tab
   * before the first: focus goes back to the panel, which a popover on the
   * page's body does not follow in the Tab order.
   */
  readonly onTabOut: () => void;
}

/**
 * The details where the view shows them: in the host's popover level with
 * `row`, or in the bar. A host without a details popover shows the bar.
 */
export function FieldDetails({
  placement,
  row,
  surface,
  ...content
}: FieldDetailsContent & {
  readonly placement: FieldDetailsPlacement;
  readonly row: HTMLElement | null;
  /** The element the details draw in, which a press outside leaves. */
  readonly surface: Ref<HTMLElement>;
}) {
  const host = useWorkbenchHost();
  const titleId = useUniqueId();
  const panel = useFieldsPanelRows()?.panel.current ?? null;
  const Popover = host.fieldsAction?.details;
  const bar = useRef<HTMLDivElement>(null);
  // A bar too short for the details, such as at 200% zoom, opens on what the
  // note gets: "In your note" and its snippet stand at its top, under the
  // field's row the list keeps in view, and the rest scrolls.
  const field = content.node.key;
  useLayoutEffect(() => {
    const box = bar.current;
    if (!box || box.scrollHeight <= box.clientHeight) return;
    const item = box.querySelector<HTMLElement>(
      "[data-part=item][data-state=note]",
    );
    if (!item) return;
    box.scrollTop +=
      item.getBoundingClientRect().top - box.getBoundingClientRect().top;
  }, [field]);
  if (placement === "popover" && Popover && row && panel)
    return (
      <Popover
        anchor={row}
        panel={panel}
        onClose={content.onClose}
        labelledBy={titleId}
      >
        <DetailsBody
          {...content}
          titleId={titleId}
          surface={surface}
          state="popover"
        />
      </Popover>
    );
  return (
    <div ref={bar} data-part="details-bar" className={fieldDetailsDetailsBar}>
      <DetailsBody
        {...content}
        titleId={titleId}
        surface={surface}
        state="bar"
      />
    </div>
  );
}

function DetailsBody({
  node,
  label,
  context,
  forms,
  onInsert,
  onCopy,
  onClose,
  takeFocus = false,
  onTabOut,
  titleId,
  surface,
  state,
}: FieldDetailsContent & {
  readonly titleId: string;
  readonly surface: Ref<HTMLElement>;
  readonly state: FieldDetailsPlacement;
}) {
  const closeLabel = m.workbench_fields_details_close();
  const closeTooltip = tooltipAttrs(closeLabel);
  const value =
    node.kind === "value" && typeof node.value === "string"
      ? node.value
      : fieldValueText(node);
  // A list goes into the note in the form the reader picks, its first by
  // default; any other field has one form.
  const [kind, setKind] = useState<SnippetKind>(forms[0]!.kind);
  const form = forms.find((each) => each.kind === kind) ?? forms[0]!;
  const formsId = useUniqueId();
  const { result } = form;
  const empty = m.workbench_fields_empty();
  // A list shows its values one per line, numbered: every item, an item
  // without a value marked as empty.
  const values = isList(node) ? listItemValues(node) : [];
  const reasonId = useUniqueId();
  const section = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!takeFocus) return;
    section.current
      ?.querySelector<HTMLElement>(
        "input:checked, [data-part=insert]:not(:disabled), [data-part=copy]",
      )
      ?.focus({ preventScroll: true });
  }, [takeFocus]);
  const formLabels: Partial<Record<SnippetKind, string>> = {
    joined: m.workbench_fields_details_form_joined(),
    loop: m.workbench_fields_details_form_loop(),
  };
  return (
    <section
      ref={(element) => {
        section.current = element;
        if (typeof surface === "function") surface(element);
        else if (surface) surface.current = element;
      }}
      aria-labelledby={titleId}
      data-part="details"
      data-state={state}
      className={fieldDetailsDetails}
      // Mod+Enter inserts the field in the form the details show, as it
      // inserts the selected row from the search.
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:checked",
            ),
          ];
          const edge = event.shiftKey ? controls[0] : controls.at(-1);
          if (event.target !== edge) return;
          event.preventDefault();
          onTabOut();
          return;
        }
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
        if (composing(event) || !onInsert) return;
        event.preventDefault();
        onInsert(form, { keepOpen: event.shiftKey });
      }}
    >
      <div data-part="header" className="zt:flex zt:items-start zt:gap-1">
        <span
          data-part="heading"
          className="zt:flex zt:min-w-0 zt:flex-1 zt:flex-col"
        >
          <span
            data-part="context"
            className="zt:truncate zt:text-xs zt:text-muted-foreground"
          >
            {context}
          </span>
          <span
            id={titleId}
            data-part="title"
            className="zt:truncate zt:font-semibold"
          >
            {label}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          {...closeTooltip}
          data-part="close"
          className={iconButton({ className: "zt:shrink-0" })}
        >
          <Icon name="x" />
        </button>
      </div>
      {values.length > 1 ? (
        <ol data-part="values" className={fieldDetailsValues}>
          {values.map((text, index) => (
            <li
              key={index}
              data-part="values-item"
              className="zt:flex zt:gap-2 zt:[overflow-wrap:anywhere]"
            >
              <span
                data-part="values-index"
                className="zt:w-4 zt:shrink-0 zt:text-end zt:text-xs zt:leading-5 zt:tabular-nums zt:text-muted-foreground"
              >
                {index + 1}
              </span>
              <span
                data-part="values-text"
                data-state={text === null || text === "" ? "empty" : undefined}
                className="zt:min-w-0 zt:whitespace-pre-wrap zt:data-[state=empty]:text-muted-foreground zt:data-[state=empty]:italic"
              >
                {text === null || text === "" ? empty : text}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p
          data-part="value"
          data-state={value === "" ? "empty" : undefined}
          className={fieldDetailsValue}
        >
          {value === "" ? empty : value}
        </p>
      )}
      <div data-part="item" data-state={"path"} className={fieldDetailsItem}>
        <span data-part="label" className={fieldDetailsLabel}>
          {m.workbench_fields_details_path()}
        </span>
        <code
          data-part="path"
          className="zt:font-mono zt:text-xs zt:break-all zt:text-muted-foreground"
        >
          {node.kind === "list-property"
            ? m.workbench_fields_details_path_each({
                list: formatPath(node.list, "zt"),
                property: node.property,
              })
            : formatPath(node.path, "zt")}
        </code>
      </div>
      <div data-part="item" data-state={"note"} className={fieldDetailsItem}>
        <div
          data-part="item-header"
          className="zt:flex zt:flex-wrap zt:items-center zt:gap-x-2 zt:gap-y-1"
        >
          <span id={formsId} data-part="label" className={fieldDetailsLabel}>
            {m.workbench_fields_details_in_note()}
          </span>
          {forms.some(isListForm) && (
            // Named by its visible label, so no tooltip stands on the group.
            <div
              role="radiogroup"
              aria-labelledby={formsId}
              data-part="forms"
              className="zt:ms-auto zt:flex zt:flex-wrap zt:gap-x-3 zt:text-xs"
            >
              {forms.map((each) => (
                <label
                  key={each.kind}
                  data-part="form"
                  className="zt:inline-flex zt:cursor-pointer zt:items-center zt:gap-1 zt:text-muted-foreground zt:has-checked:text-foreground"
                >
                  <input
                    type="radio"
                    name={formsId}
                    checked={form.kind === each.kind}
                    onChange={() => setKind(each.kind)}
                  />
                  {formLabels[each.kind]}
                </label>
              ))}
            </div>
          )}
        </div>
        <code
          data-part="snippet"
          className="zt:font-mono zt:text-xs zt:break-all zt:whitespace-pre-wrap zt:text-foreground"
        >
          {form.snippet}
        </code>
        <p
          data-part="result"
          data-state={result === null ? "empty" : undefined}
          className={fieldDetailsResult}
        >
          <span
            aria-hidden="true"
            data-part="result-icon"
            className="zt:mt-0.5 zt:flex zt:shrink-0 zt:text-faint zt:[&_svg]:size-3"
          >
            <Icon name="corner-down-right" />
          </span>
          <span>{result ?? empty}</span>
        </p>
      </div>
      <div data-part="actions" className={fieldDetailsActions}>
        <Button
          variant="cta"
          icon="text-cursor-input"
          disabled={!onInsert}
          aria-describedby={onInsert ? undefined : reasonId}
          onClick={(event) => onInsert?.(form, { keepOpen: event.shiftKey })}
          data-part="insert"
          className="zt:[&_svg]:size-(--icon-s)"
        >
          {m.workbench_fields_insert()}
        </Button>
        <button
          type="button"
          onClick={() => onCopy(form)}
          data-part="copy"
          className="zt:gap-1.5 zt:[&_svg]:size-(--icon-s)"
        >
          <Icon name="copy" />
          {m.workbench_fields_copy()}
        </button>
      </div>
      {!onInsert && (
        <p
          id={reasonId}
          data-part="reason"
          className="zt:text-xs zt:text-muted-foreground"
        >
          {m.workbench_fields_choose_place()}
        </p>
      )}
    </section>
  );
}

/** A form a list goes into the note in, which the reader picks by name. */
function isListForm({ kind }: FieldForm): boolean {
  return kind === "joined" || kind === "loop";
}
