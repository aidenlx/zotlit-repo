// Presentational tree renderer for display-tree nodes; raises intent via callbacks only.

import type {
  DisplayNode,
  HelperNode,
  ListPropertyNode,
  PlaceholderNode,
  ValueNode,
} from "#core/data-tree/index.ts";
import { regex } from "arkregex";
import type { IconName } from "obsidian";
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import { SECTION_ICONS } from "./explorer-sections.ts";
import type { ExplorerSectionId } from "./explorer-sections.ts";
import {} from "./host.tsx";
import { paneCover } from "./look.ts";

import { formatPath } from "#core/data-tree/index.ts";

/** Stays at the top while its section scrolls past, on the ground of the panel it stands in. */
const explorerTreeSectionHeading = cn("zt:sticky zt:top-0 zt:z-10", paneCover);
const explorerTreeChevronIcon =
  "zt:flex zt:size-(--icon-size) zt:items-center zt:justify-center zt:in-data-[expanded]:rotate-90";
/**
 * The row whose details stand open keeps its own ground. The row ↑/↓
 * selected also wears the ring Obsidian draws on the file explorer's
 * keyboard row (`.tree-item-self.has-focus`), which hover never shows.
 */
const explorerTreeRow =
  "zt:group/row zt:rounded-sm zt:flex zt:min-w-0 zt:items-start zt:gap-x-1 zt:px-1 zt:py-1 zt:data-line:h-7 zt:data-line:items-center zt:data-line:py-0 zt:hover:bg-muted zt:focus-within:bg-muted zt:data-[state=matched]:bg-(--text-highlight-bg) zt:data-selected:bg-muted zt:data-selected:shadow-[inset_0_0_0_2px_var(--background-modifier-border-focus)] zt:data-open:bg-accent";
/**
 * Key and value share one line while both fit; a longer value drops to
 * its own line beneath the key. A Fields Panel row (`line`) keeps both
 * on one line, the value cut with an ellipsis, and a click on it shows
 * its details.
 */
const explorerTreeContents =
  "zt:flex zt:min-w-0 zt:flex-1 zt:flex-wrap zt:gap-x-1.5 zt:select-text zt:[overflow-wrap:anywhere] zt:data-[state=line]:cursor-pointer zt:data-[state=line]:items-center zt:data-[state=line]:self-stretch zt:data-[state=line]:flex-nowrap zt:data-[state=line]:overflow-hidden zt:data-[state=line]:whitespace-nowrap zt:data-[state=line]:*:data-[part=value]:truncate";
const explorerTreeGroup =
  "zt:ms-2.5 zt:border-s zt:border-(--nav-indentation-guide-color) zt:ps-2 zt:data-[state=line]:ms-0 zt:data-[state=line]:border-0 zt:data-[state=line]:ps-0 zt:data-[state=line]:in-data-[part=group]:ps-3";
/** Revealed by hover or focus; a touch device has neither, so it keeps them visible. */
const explorerTreeActions =
  "zt:flex zt:shrink-0 zt:items-center zt:gap-0.5 zt:opacity-0 zt:group-hover/row:opacity-100 zt:group-focus-within/row:opacity-100 zt:group-data-selected/row:opacity-100 zt:group-data-open/row:opacity-100 zt:[.is-mobile_&]:opacity-100";
const explorerTreeKey =
  "zt:font-mono zt:text-foreground zt:data-[state=labeled]:font-sans zt:data-[state=labeled]:font-medium";
/**
 * A Fields Panel row's label, from the section icon's edge, with the
 * chevron of a field that opens after it. A nested field's label
 * stands a little in, behind the guide line its siblings continue.
 */
const explorerTreeFieldLabel =
  "zt:flex zt:w-2/5 zt:min-w-0 zt:shrink-0 zt:items-center zt:gap-0.5 zt:self-stretch zt:*:data-[part=key]:truncate zt:data-[state=nested]:ms-1 zt:data-[state=nested]:border-s zt:data-[state=nested]:border-(--nav-indentation-guide-color) zt:data-[state=nested]:ps-2";
const explorerTreeValue = "zt:min-w-0";
const explorerTreeHint = "zt:text-muted-foreground zt:tabular-nums";
const explorerTreePlaceholder = "zt:text-muted-foreground zt:italic";
const explorerTreeNull = "zt:text-muted-foreground zt:italic";
const explorerTreeString = "zt:text-green";
const explorerTreeLongToggle =
  "zt:rounded-xs zt:ms-0.5 zt:cursor-pointer zt:px-1 zt:text-muted-foreground zt:underline zt:decoration-dotted zt:underline-offset-2 zt:select-none zt:hover:bg-muted zt:hover:text-foreground zt:focus-visible:shadow-(--input-box-shadow-focus)";

/** Shared Enter/Space activation for `role="button"` spans, so keyboard users get the same click behavior as a mouse. */
function activateOnEnterOrSpace<E extends React.KeyboardEvent>(
  action: (e: E) => void,
): (e: E) => void {
  return (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action(e);
    }
  };
}

/** One section of the tree: its heading, its top-level nodes, and the names those nodes show. */
export interface DisplaySection {
  readonly id: ExplorerSectionId;
  readonly label: string;
  readonly collapsed: boolean;
  readonly nodes: readonly DisplayNode[];
  /** Reader-facing names by node key, nested nodes included; a node without one shows its raw key. */
  readonly labels: ReadonlyMap<string, string>;
}

/**
 * The rows of the Fields Panel: one line each, with the selected row and the
 * row whose details stand open. A click on a row shows or hides its details.
 */
export interface FieldRowState {
  readonly selected: string | null;
  readonly open: string | null;
  /** The id of the row for `key`, which the search names as active. */
  readonly idOf: (key: string) => string;
  readonly onRowClick: (node: DisplayNode) => void;
}

const FieldRowsContext = createContext<FieldRowState | null>(null);

export interface DisplayTreeProps {
  sections: readonly DisplaySection[];
  /** Keys of nodes directly matched by the filter; null when no filter is active. */
  matchedKeys: ReadonlySet<string> | null;
  onToggle: (key: string) => void;
  /** Absent while a filter holds every matching section open. */
  onToggleSection?: (id: string) => void;
  /**
   * Inserts the node's field; `keepOpen` when the reader held Shift, so the
   * Fields Panel stays open for the next field.
   */
  onInsert?: (node: DisplayNode, keepOpen: boolean) => void;
  /** The row's Menu, opened from its own control; anchored under that control. */
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
  /** The same Menu, opened by a right-click on the row; anchored at the pointer. */
  onFieldContextMenu: (node: DisplayNode, event: React.MouseEvent) => void;
  /** Present in the Fields Panel, whose rows are one line and keep details. */
  rows?: FieldRowState;
}

export function DisplayTree({
  sections,
  matchedKeys,
  onToggle,
  onToggleSection,
  onInsert,
  onTemplateMenu,
  onFieldContextMenu,
  rows,
}: DisplayTreeProps): React.ReactElement {
  const id = useUniqueId();
  return (
    <FieldRowsContext.Provider value={rows ?? null}>
      <div data-part="sections" className="zt:flex zt:flex-col zt:gap-2">
        {sections.map((section) => (
          <section
            key={section.id}
            data-workbench-section={section.id}
            data-part="section"
            data-state={section.collapsed ? "collapsed" : "expanded"}
            className=""
          >
            <SectionHeader
              section={section}
              labelId={`${id}-${section.id}`}
              onToggle={onToggleSection && (() => onToggleSection(section.id))}
            />
            {!section.collapsed && (
              <ul
                role="tree"
                aria-labelledby={`${id}-${section.id}`}
                data-part="tree"
                className="zt:text-xs zt:leading-normal"
              >
                {section.nodes.map((node) => (
                  <TreeNode
                    key={node.key}
                    node={node}
                    labels={section.labels}
                    matchedKeys={matchedKeys}
                    onToggle={onToggle}
                    onInsert={onInsert}
                    onTemplateMenu={onTemplateMenu}
                    onFieldContextMenu={onFieldContextMenu}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </FieldRowsContext.Provider>
  );
}

/**
 * The section's icon, name and count of its own fields, with the chevron at
 * its end; its visible text is its accessible name. The host keeps it in
 * view while its section scrolls past.
 */
function SectionHeader({
  section,
  labelId,
  onToggle,
}: {
  section: DisplaySection;
  /** The id the tree beneath points at for its name. */
  labelId: string;
  onToggle?: () => void;
}) {
  return (
    <div data-part="section-heading" className={explorerTreeSectionHeading}>
      <button
        type="button"
        aria-expanded={!section.collapsed}
        aria-disabled={onToggle ? undefined : true}
        onClick={onToggle}
        data-part="section-header"
        className="clickable-icon zt:[--icon-size:var(--icon-xs)] zt:text-muted-foreground zt:focus-visible:shadow-(--input-box-shadow-focus)"
      >
        <span
          aria-hidden="true"
          data-part="section-icon"
          className="zt:flex zt:size-(--icon-size) zt:shrink-0 zt:items-center zt:justify-center zt:text-(--icon-color)"
        >
          <Icon name={SECTION_ICONS[section.id]} />
        </span>
        <span
          id={labelId}
          data-part="section-label"
          className="zt:min-w-0 zt:truncate zt:text-start"
        >
          {section.label}
        </span>{" "}
        <span
          data-part="section-count"
          className="zt:font-normal zt:tabular-nums zt:text-faint"
        >
          {section.nodes.length}
        </span>
        <span
          data-expanded={section.collapsed ? undefined : ""}
          data-part="section-chevron"
          className="zt:ms-auto zt:flex zt:size-(--icon-size) zt:shrink-0 zt:items-center zt:justify-center zt:in-aria-disabled:opacity-40"
        >
          <span data-part="chevron-icon" className={explorerTreeChevronIcon}>
            <Icon name="chevron-right" />
          </span>
        </span>
      </button>
    </div>
  );
}

interface TreeNodeProps {
  node: DisplayNode;
  /** Reader-facing names by node key; a node without one shows its key as written. */
  labels: ReadonlyMap<string, string>;
  /** A field inside another field, whose label stands behind a guide line in the Fields Panel. */
  nested?: boolean;
  matchedKeys: ReadonlySet<string> | null;
  onToggle: (key: string) => void;
  onInsert?: (node: DisplayNode, keepOpen: boolean) => void;
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
  onFieldContextMenu: (node: DisplayNode, event: React.MouseEvent) => void;
}

/**
 * The label cell of a Fields Panel row: whether its field is nested, and the
 * chevron that follows the label of a field that opens.
 */
interface FieldLabelCell {
  readonly nested: boolean;
  readonly chevron: ReactNode;
  /** The id of the label text, which names the row. */
  readonly labelId: string;
  /** The id of the value, which describes the row. */
  readonly valueId: string;
}

/** What a row draws: its node, the name it shows, and its label cell in a Fields Panel. */
interface RowProps<N extends DisplayNode = DisplayNode> {
  node: N;
  label?: string;
  cell?: FieldLabelCell;
}

function TreeNode({
  node,
  labels,
  nested = false,
  matchedKeys,
  onToggle,
  onInsert,
  onTemplateMenu,
  onFieldContextMenu,
}: TreeNodeProps) {
  const rows = useContext(FieldRowsContext);
  const label = labels.get(node.key);
  const isExpanded = node.kind === "value" && node.children !== undefined;
  const isExpandable = node.kind === "value" && node.expandable;
  const isMatched = matchedKeys?.has(node.key) ?? false;
  const selected = rows?.selected === node.key;
  const open = rows?.open === node.key;
  const chevron = isExpandable ? (
    <Chevron expanded={isExpanded} onClick={() => onToggle(node.key)} />
  ) : null;
  const rowId = rows?.idOf(node.key);
  // A Fields Panel row reads as its visible label, its value as its
  // description, without its controls or its nested rows.
  const cell = rowId
    ? {
        nested,
        chevron,
        labelId: `${rowId}-label`,
        valueId: `${rowId}-value`,
      }
    : undefined;

  return (
    <li
      role="treeitem"
      data-workbench-field={node.key}
      aria-expanded={isExpandable ? isExpanded : undefined}
      {...(cell && {
        id: rowId,
        "aria-selected": selected,
        "aria-labelledby": cell.labelId,
        "aria-describedby": cell.valueId,
      })}
    >
      <div
        data-part="row"
        data-state={isMatched ? "matched" : undefined}
        className={explorerTreeRow}
        // "true" when selected; Obsidian's variant reads the attribute's
        // presence.
        data-selected={selected ? "true" : undefined}
        data-open={open ? "" : undefined}
        data-line={rows ? "" : undefined}
        onContextMenu={(event) => {
          event.preventDefault();
          onFieldContextMenu(node, event);
        }}
        // A click on the row, not on one of its controls or links, shows or
        // hides its details.
        onClick={
          rows
            ? (event) => {
                const target = event.target as Element;
                if (target.closest("a, button, [role=button]")) return;
                rows.onRowClick(node);
              }
            : undefined
        }
      >
        {!rows &&
          (chevron ?? (
            <span data-part="spacer" className="zt:w-6 zt:shrink-0" />
          ))}
        {/* The host lays the key and the value out as a wrapping row: one line while both fit, the value on its own line beneath the key when it does not. The space between them survives in text content only. A Fields Panel row keeps one line, its label in a cell of its own with its chevron after it. */}
        <div
          data-part="contents"
          data-state={rows ? "line" : undefined}
          className={explorerTreeContents}
        >
          <NodeRow node={node} label={label} cell={cell} />
        </div>
        <ActionCluster
          node={node}
          onInsert={onInsert}
          onTemplateMenu={onTemplateMenu}
        />
      </div>
      {node.kind === "value" && node.children && (
        <ul
          role="group"
          data-part="group"
          data-state={rows ? "line" : undefined}
          className={explorerTreeGroup}
        >
          {node.children.map((child) => (
            <TreeNode
              key={child.key}
              node={child}
              labels={labels}
              nested
              matchedKeys={matchedKeys}
              onToggle={onToggle}
              onInsert={onInsert}
              onTemplateMenu={onTemplateMenu}
              onFieldContextMenu={onFieldContextMenu}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function Chevron({
  expanded,
  onClick,
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={m.workbench_explorer_toggle_node()}
      onClick={onClick}
      onKeyDown={activateOnEnterOrSpace(() => onClick())}
      data-expanded={expanded ? "" : undefined}
      data-part="chevron"
      className="clickable-icon zt:w-6 zt:shrink-0 zt:[--icon-size:var(--icon-xs)] zt:focus-visible:shadow-(--input-box-shadow-focus)"
    >
      <span data-part="chevron-icon" className={explorerTreeChevronIcon}>
        <Icon name="chevron-right" />
      </span>
    </span>
  );
}

/** The row's two actions: insert, and the menu that holds everything else. The host reveals them on hover or focus. */
function ActionCluster({
  node,
  onInsert,
  onTemplateMenu,
}: {
  node: DisplayNode;
  onInsert?: (node: DisplayNode, keepOpen: boolean) => void;
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
}) {
  return (
    <div data-part="actions" className={explorerTreeActions}>
      {onInsert && (
        <ClusterButton
          icon="text-cursor-input"
          label={m.workbench_fields_put_in_note()}
          onClick={(event) => onInsert(node, event.shiftKey)}
        />
      )}
      <ClusterButton
        icon="ellipsis"
        label={m.workbench_explorer_row_actions()}
        onClick={(e) => onTemplateMenu(node, e)}
      />
    </div>
  );
}

function ClusterButton({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: (event: React.MouseEvent) => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      {...tooltipAttrs(label)}
      onClick={onClick}
      // Enter and Space press it as a click does, Shift included.
      onKeyDown={activateOnEnterOrSpace((e) => {
        const view = e.currentTarget.ownerDocument.defaultView!;
        e.currentTarget.dispatchEvent(
          new view.MouseEvent("click", {
            bubbles: true,
            shiftKey: e.shiftKey,
          }),
        );
      })}
      data-part="action"
      className="clickable-icon zt:[--icon-size:var(--icon-xs)] zt:focus-visible:shadow-(--input-box-shadow-focus)"
    >
      <Icon name={icon} />
    </span>
  );
}

function NodeRow({ node, label, cell }: RowProps) {
  switch (node.kind) {
    case "value":
      return <ValueRow node={node} label={label} cell={cell} />;
    case "helper":
      return <HelperRow node={node} label={label} cell={cell} />;
    case "placeholder":
      return <PlaceholderRow node={node} label={label} cell={cell} />;
    case "list-property":
      return <ListPropertyRow node={node} label={label} cell={cell} />;
  }
}

/**
 * The property name, or the array index, or the reader-facing name of a
 * top-level field. A named key keeps its raw path in the tooltip.
 */
function KeyLabel({ node, label, cell }: RowProps) {
  const tooltip = tooltipAttrs(formatPath(node.path, "zt"));
  // The row's name is the label text alone, apart from the tooltip a host
  // may draw as an aria-label.
  const text = cell ? (
    <span id={cell.labelId}>{label ?? node.label}</span>
  ) : (
    (label ?? node.label)
  );
  const key =
    label === undefined ? (
      <span data-part="key" className={explorerTreeKey}>
        {text}
      </span>
    ) : (
      <span
        {...tooltip}
        data-part="key"
        data-state={"labeled"}
        className={explorerTreeKey}
      >
        {text}
      </span>
    );
  if (!cell) return key;
  return (
    <span
      data-part="field-label"
      data-state={cell.nested ? "nested" : undefined}
      className={explorerTreeFieldLabel}
    >
      {key}
      {cell.chevron}
    </span>
  );
}

function ValueRow({ node, label, cell }: RowProps<ValueNode>) {
  return (
    <>
      <KeyLabel node={node} label={label} cell={cell} />{" "}
      <span id={cell?.valueId} data-part="value" className={explorerTreeValue}>
        <ValueContent node={node} labeled={label !== undefined} />
      </span>
    </>
  );
}

/**
 * A named field counts a list in prose parentheses and lets an object speak
 * through its preview alone; a raw key keeps the structural `[n]` / `{n}` hint.
 */
function ValueContent({
  node,
  labeled = false,
}: {
  node: ValueNode;
  labeled?: boolean;
}) {
  const line = useContext(FieldRowsContext) !== null;
  if (node.valueType === "array" || node.valueType === "object") {
    const hint = labeled
      ? node.valueType === "array"
        ? `(${node.size})`
        : null
      : node.valueType === "array"
        ? `[${node.size}]`
        : `{${node.size}}`;
    return (
      <>
        {hint !== null && (
          <span data-part="hint" className={explorerTreeHint}>
            {hint}
          </span>
        )}
        {/* A Fields Panel row keeps its items in view while it stands open. */}
        {(node.children === undefined || line) &&
          node.preview !== undefined && (
            <>
              {hint !== null && " "}
              <span data-part="placeholder" className={explorerTreePlaceholder}>
                {node.preview}
              </span>
            </>
          )}
      </>
    );
  }
  if (node.valueType === "getter")
    return (
      <span data-part="hint" className={explorerTreeHint}>
        …
      </span>
    );
  // A Fields Panel row marks a field this item has no value for.
  if (
    line &&
    (node.valueType === "null" ||
      node.valueType === "undefined" ||
      node.value === "")
  )
    return (
      <span data-part="placeholder" className={explorerTreePlaceholder}>
        {m.workbench_fields_empty()}
      </span>
    );
  return <ScalarValue node={node} />;
}

function ScalarValue({ node }: { node: ValueNode }) {
  switch (node.valueType) {
    case "string":
      return <StringValue value={node.value as string} />;
    case "number":
      return (
        <span data-part="number" className="zt:tabular-nums zt:text-blue">
          {String(node.value)}
        </span>
      );
    case "boolean":
      return (
        <span data-part="boolean" className="zt:text-purple">
          {String(node.value)}
        </span>
      );
    case "null":
      return (
        <span data-part="null" className={explorerTreeNull}>
          null
        </span>
      );
    case "undefined":
      return (
        <span
          data-part="undefined"
          className="zt:text-muted-foreground zt:italic"
        >
          undefined
        </span>
      );
    case "opaque":
      return (
        <span data-part="opaque" className="zt:break-words zt:text-cyan">
          {
            // oxlint-disable-next-line no-base-to-string -- opaque carries its own toString (Temporal/Date).
            String(node.value)
          }
        </span>
      );
    default:
      return null;
  }
}

function HelperRow({ node, label, cell }: RowProps<HelperNode>) {
  return (
    <>
      <KeyLabel node={node} label={label} cell={cell} />{" "}
      <span id={cell?.valueId} data-part="value" className={explorerTreeValue}>
        <span data-part="hint" className={explorerTreeHint}>
          {node.signatureHint}
        </span>{" "}
        {node.evaluated === null ? (
          <span data-part="null" className={explorerTreeNull}>
            null
          </span>
        ) : (
          <StringValue value={node.evaluated} />
        )}
      </span>
    </>
  );
}

function PlaceholderRow({ node, label, cell }: RowProps<PlaceholderNode>) {
  return (
    <>
      <KeyLabel node={node} label={label} cell={cell} />{" "}
      <span id={cell?.valueId} data-part="value" className={explorerTreeValue}>
        <span data-part="placeholder" className={explorerTreePlaceholder}>
          {node.reason}
        </span>
      </span>
    </>
  );
}

/** A property every item of a list has, with the values of all items in one line. */
function ListPropertyRow({ node, label, cell }: RowProps<ListPropertyNode>) {
  return (
    <>
      <KeyLabel node={node} label={label} cell={cell} />{" "}
      <span id={cell?.valueId} data-part="value" className={explorerTreeValue}>
        <span data-part="placeholder" className={explorerTreePlaceholder}>
          {node.preview === "" ? m.workbench_fields_empty() : node.preview}
        </span>
      </span>
    </>
  );
}

/** `[text](url)` — captures read below, so it keeps the typed `regex(...)` form. */
const MARKDOWN_LINK_RE = regex(
  "^\\s*\\[(?<text>[^\\]]*)\\]\\((?<url>[^)]+)\\)\\s*$",
);
/** A bare protocol URL; or a `#rgb`/`#rrggbb`(`aa`) color code — both `.test()`-only, so plain literals. */
const LINKABLE_URL_RE = /^(?:https?|file|zotero|obsidian):\S*$/i;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Longer values collapse to their first line until expanded, so one field can't push its siblings off-screen. */
const STRING_PREVIEW_LIMIT = 140;

function StringValue({ value }: { value: string }) {
  const trimmed = value.trim();

  const markdown = MARKDOWN_LINK_RE.exec(value);
  if (markdown && LINKABLE_URL_RE.test(markdown.groups.url)) {
    return (
      <LinkValue
        href={markdown.groups.url}
        label={markdown.groups.text || markdown.groups.url}
      />
    );
  }

  if (LINKABLE_URL_RE.test(trimmed)) {
    return <LinkValue href={trimmed} label={trimmed} />;
  }

  if (HEX_COLOR_RE.test(trimmed)) {
    return (
      <span
        data-part="color"
        className="zt:inline-flex zt:min-w-0 zt:items-center zt:gap-1 zt:text-green"
      >
        <span
          data-part="color-swatch"
          className="zt:rounded-xs zt:size-3 zt:shrink-0 zt:border zt:border-border"
          style={{ backgroundColor: trimmed }}
        />
        {value}
      </span>
    );
  }

  return <LongText value={value} />;
}

function LinkValue({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      {...tooltipAttrs(href)}
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      data-part="link"
      className="zt:[overflow-wrap:anywhere] zt:text-link zt:underline zt:decoration-dotted zt:hover:decoration-solid"
    >
      {label}
    </a>
  );
}

function LongText({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > STRING_PREVIEW_LIMIT || value.includes("\n");
  // A Fields Panel row is one line; its details show the whole value.
  const line = useContext(FieldRowsContext) !== null;

  if (line) {
    return (
      <span data-part="string" className={explorerTreeString}>
        {value.replaceAll(/\s+/g, " ")}
      </span>
    );
  }
  if (!isLong) {
    return (
      <span data-part="string" className={explorerTreeString}>
        {value}
      </span>
    );
  }

  const firstLine = value.split("\n", 1)[0]!;
  const clipped =
    firstLine.length > STRING_PREVIEW_LIMIT
      ? firstLine.slice(0, STRING_PREVIEW_LIMIT)
      : firstLine;
  const preview = clipped.length < value.length ? `${clipped}…` : clipped;

  const toggle = () => setExpanded((prev) => !prev);
  return (
    <span data-part="string" className={explorerTreeString}>
      <span
        data-part="long-text"
        data-state={expanded ? "expanded" : undefined}
        className="zt:line-clamp-3 zt:data-[state=expanded]:line-clamp-none zt:data-[state=expanded]:break-words zt:data-[state=expanded]:whitespace-pre-wrap"
      >
        {expanded ? value : preview}
      </span>{" "}
      <span
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={activateOnEnterOrSpace(() => toggle())}
        data-part="long-toggle"
        className={explorerTreeLongToggle}
      >
        {expanded
          ? m.workbench_explorer_show_less()
          : m.workbench_explorer_show_more()}
      </span>
    </span>
  );
}
