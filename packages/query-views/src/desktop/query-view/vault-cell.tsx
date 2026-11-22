import { Effect } from "effect";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { MouseEvent, ReactNode } from "react";

import { valueText } from "@zotlit/item-query";
import type { ProjectionJson } from "@zotlit/item-query";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import { useQueryTask } from "./model.ts";
import { LIST_TYPES } from "./table-notes.ts";
import type {
  LiteratureNotes,
  VaultHost,
  VaultPropertyType,
  VaultValue,
  VaultWrite,
} from "./table-notes.ts";
import {
  CHIPS,
  FIELD,
  LINE,
  ONE_LINE,
  VaultChip,
  VaultEditor,
  asksForMenu,
  draftOf,
  listItems,
  openChipMenu,
  openListMenu,
  valueOf,
} from "./vault-editors.tsx";
import type { ChipMenu, VaultDraft, VaultEditEnd } from "./vault-editors.tsx";

import {
  dateInputValue,
  linkOf,
  tagText,
} from "#core/query-view/vault-value.ts";
import "./vault-cell.css";

export interface VaultCellProps {
  readonly notes: LiteratureNotes;
  readonly itemKey: string;
  readonly name: string;
  readonly host: VaultHost | null;
}

export type VaultCellState = "no-note" | "empty" | "value";

export function vaultState(value: VaultValue): VaultCellState {
  if (!value.note) return "no-note";
  return vaultText(value) === "" ? "empty" : "value";
}

export function vaultText(value: VaultValue): string {
  return value.note ? valueText(value.value as ProjectionJson) : "";
}

export function onVaultChange(
  notes: Pick<LiteratureNotes, "on">,
  listener: () => void,
): () => void {
  const offNotes = notes.on("changed", listener);
  const offFrontmatter = notes.on("frontmatter-changed", listener);
  return () => {
    offNotes();
    offFrontmatter();
  };
}

export function useVaultVersion(notes: Pick<LiteratureNotes, "on">): number {
  const [version, changed] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onVaultChange(notes, changed), [notes]);
  return version;
}

export function useVaultPropertyNames(
  notes: Pick<LiteratureNotes, "on" | "propertyNames">,
): readonly string[] {
  const subscribe = useCallback(
    (listener: () => void) => onVaultChange(notes, listener),
    [notes],
  );
  const lines = useSyncExternalStore(subscribe, () =>
    notes.propertyNames().join("\n"),
  );
  return useMemo(() => (lines === "" ? [] : lines.split("\n")), [lines]);
}

export function useVaultValue({
  notes,
  itemKey,
  name,
  host,
}: VaultCellProps): VaultValue {
  const subscribe = useCallback(
    (listener: () => void) => onVaultChange(notes, listener),
    [notes],
  );
  const snapshot = useSyncExternalStore(subscribe, () =>
    JSON.stringify(notes.read(itemKey, name, host)),
  );
  return JSON.parse(snapshot) as VaultValue;
}

export function useVaultType(
  notes: Pick<LiteratureNotes, "on" | "propertyType">,
  name: string,
  value?: unknown,
): VaultPropertyType {
  const subscribe = useCallback(
    (listener: () => void) => onVaultChange(notes, listener),
    [notes],
  );
  return useSyncExternalStore(subscribe, () => notes.propertyType(name, value));
}

function useVaultManaged({
  notes,
  itemKey,
  name,
  host,
}: VaultCellProps): boolean {
  const subscribe = useCallback(
    (listener: () => void) => onVaultChange(notes, listener),
    [notes],
  );
  return useSyncExternalStore(subscribe, () =>
    notes.managed(itemKey, name, host),
  );
}

function unwrittenMessage(result: VaultWrite, name: string): string | null {
  switch (result) {
    case "cancelled":
      return m.query_view_vault_not_written({ name });
    case "managed":
      return m.query_view_vault_managed_not_written({ name });
    default:
      return null;
  }
}

export function VaultCellContent({ value }: { value: VaultValue }) {
  const state = vaultState(value);
  return (
    <span
      data-query-vault={state}
      className={state === "no-note" ? "zt:text-(--text-faint)" : undefined}
    >
      {state === "no-note" ? m.query_view_vault_no_note() : vaultText(value)}
    </span>
  );
}

export function VaultCell(props: VaultCellProps) {
  return <VaultCellContent value={useVaultValue(props)} />;
}

const REST =
  "zt:flex zt:h-(--bases-table-row-height) zt:w-0 zt:min-w-full zt:items-center zt:overflow-hidden zt:whitespace-nowrap";

function VaultPreview({
  props: { notes, itemKey, host },
  value,
  type,
  checkbox,
  editing,
  chipMenu,
}: {
  props: VaultCellProps;
  value: VaultValue;
  type: VaultPropertyType;
  editing: boolean;
  checkbox: ReactNode;
  chipMenu: (event: MouseEvent<HTMLElement>, at: number) => void;
}): ReactNode {
  const run = useQueryTask();
  const state = vaultState(value);
  if (!value.note)
    return (
      <span
        data-query-vault={state}
        className={cn(LINE, "zt:truncate zt:text-(--text-faint)")}
      >
        {m.query_view_vault_no_note()}
      </span>
    );
  if (type === "checkbox") return checkbox;
  const current = value.value;
  if (LIST_TYPES.has(type)) {
    const tags = type === "tags";
    return (
      <span
        data-query-vault={state}
        className={cn(CHIPS, "zt:min-w-0 zt:overflow-hidden")}
      >
        {listItems(current).map((item, at) => (
          <VaultChip
            key={at}
            item={item}
            tags={tags}
            data-query-vault-chip={editing ? undefined : item}
            onContextMenu={(event) => chipMenu(event, at)}
          />
        ))}
      </span>
    );
  }
  const text = vaultText(value);
  const date =
    type === "date" || type === "datetime" ? dateInputValue(type, text) : "";
  if (date !== "")
    return (
      <input
        data-query-vault={state}
        data-query-vault-date=""
        type={type === "date" ? "date" : "datetime-local"}
        value={date}
        inert
        tabIndex={-1}
        className={cn(
          FIELD,
          ONE_LINE,
          "zt:pointer-events-none zt:ps-7 zt:tabular-nums",
        )}
      />
    );
  const link =
    type === "text" && typeof current === "string" ? linkOf(current) : null;
  if (link?.kind === "internal") {
    const ref = { target: link.target, itemKey, host };
    return (
      <a
        data-query-vault={state}
        className={cn(
          LINE,
          "internal-link zt:truncate zt:data-unresolved:opacity-(--link-unresolved-opacity)",
        )}
        href={link.target}
        data-href={link.target}
        data-unresolved={notes.resolves(ref) ? undefined : ""}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          run(notes.openLink(ref, event.nativeEvent));
        }}
      >
        {link.text}
      </a>
    );
  }
  if (link?.kind === "external")
    return (
      <a
        data-query-vault={state}
        className={cn(LINE, "external-link zt:truncate")}
        href={link.target}
        target="_blank"
        rel="noopener nofollow"
        onClick={(event) => event.stopPropagation()}
      >
        {link.text}
      </a>
    );
  return (
    <span
      data-query-vault={state}
      className={cn(
        LINE,
        "zt:truncate",
        type === "number" && "zt:tabular-nums",
      )}
    >
      {text}
    </span>
  );
}

function neighbour(
  cell: HTMLElement,
  how: "next" | "previous",
): HTMLElement | undefined {
  const cells = [
    ...(cell
      .closest("tr")
      ?.querySelectorAll<HTMLElement>("[data-query-vault-cell][tabindex]") ??
      []),
  ].filter((el) => el === cell || el.getAttribute("role") === "button");
  return cells[cells.indexOf(cell) + (how === "next" ? 1 : -1)];
}

export function VaultEditCell(props: VaultCellProps) {
  const { notes, itemKey, name, host } = props;
  const value = useVaultValue(props);
  const current = value.note ? value.value : null;
  const type = useVaultType(notes, name, current);
  const managed = useVaultManaged(props) && value.note;
  const [draft, setDraft] = useState<VaultDraft | null>(null);
  const ended = useRef(false);
  const after = useRef<VaultEditEnd | null>(null);
  const cell = useRef<HTMLDivElement>(null);
  const labelId = useUniqueId();
  const editing = draft !== null;
  const editor = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    const el = editor.current;
    const at = cell.current;
    const box = at?.closest<HTMLElement>(".zt-table-scroller");
    if (!el || !at || !box) return;
    at.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
    const top = box.getBoundingClientRect().top + box.clientTop;
    const end = top + box.clientHeight;
    const start = top + (box.querySelector("thead")?.offsetHeight ?? 0);
    const under = at.getBoundingClientRect().top - start;
    if (under < -0.5) box.scrollTop += under;
    const rect = at.getBoundingClientRect();
    const below = end - rect.top;
    const above = rect.bottom - start;
    setUp(above > below);
  }, [editing]);
  useLayoutEffect(() => {
    const how = after.current;
    if (editing || how === null) return;
    after.current = null;
    const el = cell.current;
    if (!el || how === "leave") return;
    (how === "stay" ? el : (neighbour(el, how) ?? el)).focus();
  }, [editing]);
  const editable = !managed;
  const run = useQueryTask();
  const write = (next: unknown) =>
    void run(
      notes.write({ itemKey, name, value: next, host }).pipe(
        Effect.flatMap((result) =>
          Effect.sync(() => {
            const message = unwrittenMessage(result, name);
            if (message !== null) new BaseNotice(message);
          }),
        ),
      ),
      () => m.query_view_vault_write_failed({ name }),
    );
  const begin = (chip?: number) => {
    ended.current = false;
    const draft = draftOf(type, current);
    const item = chip === undefined ? undefined : draft.items[chip];
    setDraft(
      item === undefined
        ? draft
        : { ...draft, chip: { at: chip!, text: item } },
    );
  };
  const items = LIST_TYPES.has(type) && value.note ? listItems(current) : [];
  const itemMenu = (item: string, at: number): ChipMenu => ({
    item,
    ...(editable && {
      edit: () => begin(at),
      remove: () => {
        const rest = items.filter((_, i) => i !== at);
        write(rest.length === 0 ? null : rest);
      },
    }),
  });
  const chipMenu = (event: MouseEvent<HTMLElement>, at: number) => {
    event.preventDefault();
    event.stopPropagation();
    const item = items[at];
    if (item === undefined) return;
    openChipMenu(event.currentTarget, event.nativeEvent, itemMenu(item, at));
  };
  const listMenu = !editing && items.length > 0;
  const openItemsMenu = (cell: HTMLElement) =>
    openListMenu(
      cell,
      items.map((item, at) => ({
        label: type === "tags" ? tagText(item) : item,
        menu: itemMenu(item, at),
      })),
    );
  const end = (commit: boolean, edited: VaultDraft, how: VaultEditEnd) => {
    if (ended.current) return;
    ended.current = true;
    after.current = how;
    setDraft(null);
    const next = valueOf(type, edited);
    if (!commit || next === undefined) return;
    if (
      JSON.stringify(next) ===
      JSON.stringify(valueOf(type, draftOf(type, current)))
    )
      return;
    write(next);
  };
  const checkbox = type === "checkbox";
  const target = editable && !editing && !(checkbox && value.note);
  const activate = () => {
    if (!editable || editing) return;
    if (!checkbox) begin();
    else if (!value.note) write(true);
  };
  return (
    <>
      <span id={labelId} hidden>
        {managed
          ? m.query_view_vault_read_only({ name })
          : m.query_view_vault_edit({ name })}
      </span>
      <div
        ref={cell}
        data-query-vault-cell=""
        data-query-vault-name={name}
        data-query-vault-type={type}
        className={cn(
          "zt:group/vault zt:relative zt:h-[calc(var(--bases-table-row-height)-var(--border-width))] zt:w-full zt:min-w-0 zt:outline-none",
          (target || listMenu) &&
            "zt:rounded-(--bases-table-cell-radius-active) zt:focus-visible:z-1 zt:focus-visible:shadow-(--bases-table-cell-shadow-active)",
          editable &&
            !editing &&
            "zt:hover:z-1 zt:hover:shadow-(--bases-table-cell-shadow-active)",
          target && !checkbox && "zt:cursor-text",
          editing && "zt:z-2",
        )}
        role={target ? "button" : undefined}
        tabIndex={target || listMenu ? 0 : editing ? -1 : undefined}
        aria-labelledby={target || listMenu ? labelId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          activate();
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (listMenu && asksForMenu(event)) {
            event.preventDefault();
            event.stopPropagation();
            openItemsMenu(event.currentTarget);
            return;
          }
          if (!target) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          activate();
        }}
        onBlur={(event) => {
          if (draft === null) return;
          if (event.currentTarget.contains(event.relatedTarget)) return;
          end(true, draft, "leave");
        }}
      >
        <div
          className={cn(
            REST,
            type === "number" && "zt:justify-end",
            checkbox && value.note && "zt:justify-center",
            managed && "zt:group-hover/vault:pe-4",
            editing && "zt:invisible",
          )}
          aria-hidden={editing || undefined}
        >
          <VaultPreview
            props={props}
            value={value}
            type={type}
            editing={editing}
            chipMenu={chipMenu}
            checkbox={
              <input
                data-query-vault-checkbox=""
                type="checkbox"
                aria-labelledby={labelId}
                checked={current === true}
                data-indeterminate={current == null ? "true" : undefined}
                aria-checked={current == null ? "mixed" : current === true}
                disabled={!editable}
                onChange={() => write(current !== true)}
              />
            }
          />
        </div>
        {managed && (
          <span
            data-query-vault-managed=""
            className="zt:invisible zt:absolute zt:inset-y-0 zt:end-0 zt:flex zt:items-center zt:px-2 zt:text-(--text-faint) zt:group-hover/vault:visible"
            {...tooltipAttrs(m.query_view_vault_managed())}
          >
            <Icon name="lock" size="xs" />
          </span>
        )}
        {draft !== null && (
          <div
            ref={editor}
            data-query-vault-editor=""
            data-up={up ? "" : undefined}
            className="zt:absolute zt:inset-x-0 zt:top-0 zt:z-1 zt:min-h-(--bases-table-row-height) zt:rounded-(--bases-table-cell-radius-focus) zt:bg-(--background-primary) zt:shadow-(--bases-table-cell-shadow-focus) zt:data-up:top-auto zt:data-up:-bottom-(--border-width)"
          >
            <VaultEditor
              type={type}
              labelId={labelId}
              draft={draft}
              onDraft={setDraft}
              onEnd={end}
              suggestions={() => notes.suggestions(name, type)}
            />
          </div>
        )}
      </div>
    </>
  );
}
