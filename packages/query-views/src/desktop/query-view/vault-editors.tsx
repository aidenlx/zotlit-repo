import { Effect } from "effect";
import {
  AbstractInputSuggest,
  Component,
  Menu,
  prepareFuzzySearch,
  renderMatches,
  Scope,
} from "obsidian";
import type { App, SearchMatchPart, SearchResult } from "obsidian";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react";

import { valueText } from "@zotlit/item-query";
import type { ProjectionJson } from "@zotlit/item-query";
import { useObsidianApp } from "@zotlit/obsidian-kit/app-context.ts";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { holdScopeWhileFocused } from "@zotlit/obsidian-kit/focus-scope.ts";
import { hasActiveMenu, showMenuAtButton } from "@zotlit/obsidian-kit/menu.ts";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { composing } from "@zotlit/ui";

import { LIST_TYPES } from "./table-notes.ts";
import type { VaultPropertyType } from "./table-notes.ts";

import {
  dateInputValue,
  dateValue,
  tagText,
} from "#core/query-view/vault-value.ts";
import {
  canClearSuggestHighlight,
  clearSuggestHighlight,
} from "#obsidian/query-view/obsidian-private/suggest-highlight.ts";

export interface VaultDraft {
  readonly text: string;
  readonly items: readonly string[];
  readonly chip?: { readonly at: number; readonly text: string };
}

export type VaultEditEnd = "stay" | "next" | "previous" | "leave";

export function listItems(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) =>
    item === null || item === undefined
      ? []
      : [valueText(item as ProjectionJson)],
  );
}

const isDate = (type: VaultPropertyType): type is "date" | "datetime" =>
  type === "date" || type === "datetime";

export function draftOf(type: VaultPropertyType, value: unknown): VaultDraft {
  if (LIST_TYPES.has(type)) return { text: "", items: listItems(value) };
  const text = valueText(value as ProjectionJson);
  if (isDate(type)) return { text: dateInputValue(type, text), items: [] };
  return { text, items: [] };
}

export function valueOf(type: VaultPropertyType, draft: VaultDraft): unknown {
  if (LIST_TYPES.has(type)) {
    const items = withPending(withChip(draft)).items;
    return items.length === 0 ? null : items;
  }
  if (isDate(type)) return dateValue(type, draft.text);
  const text = type === "number" ? draft.text.trim() : draft.text.trimEnd();
  if (text === "") return null;
  if (type === "number") {
    const number = Number(text);
    return Number.isFinite(number) ? number : undefined;
  }
  return text;
}

function withPending(draft: VaultDraft): VaultDraft {
  const text = draft.text.trim();
  if (text === "") return draft;
  if (draft.items.includes(text)) return { ...draft, text: "" };
  return { text: "", items: [...draft.items, text] };
}

const collator = new Intl.Collator(undefined, {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

const byName = (a: string, b: string) => collator.compare(a, b);

function withChip(draft: VaultDraft): VaultDraft {
  const { chip, ...rest } = draft;
  if (!chip) return draft;
  const text = chip.text.trim();
  const repeats = draft.items.some(
    (item, at) => at !== chip.at && item === text,
  );
  return {
    ...rest,
    items: draft.items.flatMap((item, at) => {
      if (at !== chip.at) return [item];
      if (text === "") return [];
      return text === item || repeats ? [item] : [text];
    }),
  };
}

function withoutItem(draft: VaultDraft, at: number): VaultDraft {
  const { chip, ...rest } = draft;
  const items = draft.items.filter((_, i) => i !== at);
  if (!chip || chip.at === at) return { ...rest, items };
  return {
    ...rest,
    items,
    chip: { ...chip, at: chip.at > at ? chip.at - 1 : chip.at },
  };
}

function withoutChip({ chip: _chip, ...rest }: VaultDraft): VaultDraft {
  return rest;
}

export interface ChipMenu {
  readonly item: string;
  readonly edit?: () => void;
  readonly remove?: () => void;
}

function copyItem(item: string) {
  navigator.clipboard.writeText(item).catch((error: unknown) => {
    Effect.runSyncWith(logServices)(
      Effect.logWarning("The Query View could not copy a list item").pipe(
        Effect.annotateLogs({ error }),
        withLogCategory("views", "query-view", "vault"),
      ),
    );
  });
}

function addChipItems(menu: Menu, { item, edit, remove }: ChipMenu) {
  if (edit)
    menu.addItem((entry) =>
      entry
        .setTitle(m.query_view_vault_chip_edit())
        .setIcon("pencil")
        .onClick(edit),
    );
  menu.addItem((entry) =>
    entry
      .setTitle(m.query_view_vault_chip_copy())
      .setIcon("copy")
      .onClick(() => copyItem(item)),
  );
  if (remove)
    menu.addItem((entry) =>
      entry
        .setTitle(m.query_view_vault_chip_remove())
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(remove),
    );
}

function showMenu(
  menu: Menu,
  anchor: HTMLElement,
  // oxlint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
  pointer: globalThis.MouseEvent | null,
) {
  if (!pointer || (pointer.clientX === 0 && pointer.clientY === 0))
    showMenuAtButton(menu, anchor);
  else menu.setParentElement(anchor).showAtMouseEvent(pointer);
}

export function openChipMenu(
  chip: HTMLElement,
  // oxlint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
  pointer: globalThis.MouseEvent | null,
  item: ChipMenu,
): Menu | null {
  if (hasActiveMenu(chip)) return null;
  const menu = new Menu();
  addChipItems(menu, item);
  showMenu(menu, chip, pointer);
  return menu;
}

export interface ListMenuEntry {
  readonly label: string;
  readonly menu: ChipMenu;
}

export function openListMenu(
  cell: HTMLElement,
  entries: readonly ListMenuEntry[],
): Menu | null {
  if (entries.length === 0 || hasActiveMenu(cell)) return null;
  const [only] = entries;
  if (entries.length === 1 && only) {
    const chip = cell.querySelector<HTMLElement>("[data-query-vault-chip]");
    return openChipMenu(chip ?? cell, null, only.menu);
  }
  const menu = new Menu();
  for (const { label, menu: item } of entries)
    menu.addItem((entry) => {
      if (!item.edit && !item.remove) {
        entry
          .setTitle(m.query_view_vault_chip_copy_item({ item: label }))
          .setIcon("copy")
          .onClick(() => copyItem(item.item));
        return;
      }
      entry.setTitle(label);
      addChipItems(entry.setSubmenu(), item);
    });
  showMenu(menu, cell, null);
  return menu;
}

export function asksForMenu(event: KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

function valueMatch(query: string): (value: string) => SearchResult | null {
  const needle = query.toLowerCase();
  return (value) => {
    const text = value.toLowerCase();
    const matches: SearchMatchPart[] = [];
    for (
      let at = text.indexOf(needle);
      at !== -1;
      at = text.indexOf(needle, at + needle.length + 1)
    )
      matches.push([at, at + needle.length]);
    const first = matches[0]?.[0];
    const end = matches.at(-1)?.[1];
    if (first === undefined || end === undefined) return null;
    const score =
      -(matches.length - 1) -
      (end - first + 1 - needle.length) / 100 -
      first / 1000 -
      text.length / 10_000;
    return { score, matches };
  };
}

function tagMatch(query: string): (tag: string) => SearchResult | null {
  const search = prepareFuzzySearch(query.toLowerCase());
  return (tag) => search(tag.toLowerCase());
}

const matchFor = (query: string, tags: boolean) =>
  tags ? tagMatch(query) : valueMatch(query);

export function suggestionsFor(
  values: readonly string[],
  query: string,
  {
    taken = [],
    tags = false,
  }: {
    readonly taken?: readonly string[];
    readonly tags?: boolean;
  } = {},
): string[] {
  const listed = [...new Set(values)]
    .filter((value) => !taken.includes(value))
    .sort(byName);
  const text = query.trim();
  if (text === "") return listed;
  const match = matchFor(text, tags);
  return listed
    .flatMap((value) => {
      const found = match(value);
      return found ? [{ value, score: found.score }] : [];
    })
    .sort((a, b) => b.score - a.score)
    .map(({ value }) => value);
}

interface ValueSuggestSource {
  readonly tags: boolean;
  values(): readonly string[];
  taken(): readonly string[];
  pick(value: string): void;
}

class ValueSuggest extends AbstractInputSuggest<string> {
  readonly #source: ValueSuggestSource;
  readonly #field: HTMLInputElement | HTMLTextAreaElement;
  #query = "";

  constructor(
    app: App,
    field: HTMLInputElement | HTMLTextAreaElement,
    source: ValueSuggestSource,
  ) {
    super(app, field as HTMLInputElement);
    this.#field = field;
    this.#source = source;
    this.suggestEl.classList.add("mod-property-value");
    this.scope.register(["Shift"], "Enter", (event) => {
      if (composing(event)) return;
      this.selectSuggestion(this.getValue());
      return false;
    });
  }

  override open(): void {
    super.open();
    if (this.getValue() === "") clearSuggestHighlight(this);
  }

  override getValue(): string {
    return this.#field.value;
  }

  override setValue(value: string): void {
    this.#field.value = value;
  }

  protected override getSuggestions(query: string): string[] {
    this.#query = query.trim();
    if (this.#query === "" && !canClearSuggestHighlight(this)) return [];
    return suggestionsFor(this.#source.values(), query, {
      taken: this.#source.taken(),
      tags: this.#source.tags,
    });
  }

  override renderSuggestion(value: string, el: HTMLElement): void {
    el.classList.add("mod-nowrap");
    renderMatches(
      el,
      value,
      this.#query === ""
        ? null
        : (matchFor(this.#query, this.#source.tags)(value)?.matches ?? null),
    );
  }

  override selectSuggestion(value: string): void {
    this.close();
    this.#source.pick(value);
  }
}

function showAgain(field: HTMLElement | null) {
  if (field && field.ownerDocument.activeElement === field)
    field.dispatchEvent(new FocusEvent("focus"));
}

function useValueSuggest(
  field: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  source: ValueSuggestSource | null,
) {
  const app = useObsidianApp();
  const latest = useRef(source);
  latest.current = source;
  const suggests = source !== null;
  const tags = source?.tags ?? false;
  useEffect(() => {
    const el = field.current;
    if (!el || !suggests) return;
    const suggest = new ValueSuggest(app, el, {
      tags,
      values: () => latest.current?.values() ?? [],
      taken: () => latest.current?.taken() ?? [],
      pick: (value) => latest.current?.pick(value),
    });
    showAgain(el);
    return () => suggest.close();
  }, [app, field, suggests, tags]);
}

export const LINE =
  "zt:px-2 zt:py-[calc((var(--bases-table-row-height)-1lh)/2)]";

export const CHIPS = cn(LINE, "zt:leading-(--bases-table-row-height)");

export const FIELD = cn(
  "zt:relative zt:block zt:w-full zt:min-w-0 zt:bg-transparent zt:text-(--text-normal) zt:outline-none",
  LINE,
);

export const ONE_LINE = "zt:h-(--bases-table-row-height)";

export interface VaultEditorProps {
  readonly type: VaultPropertyType;
  readonly labelId: string;
  readonly draft: VaultDraft;
  readonly onDraft: (draft: VaultDraft) => void;
  readonly onEnd: (
    commit: boolean,
    draft: VaultDraft,
    how: VaultEditEnd,
  ) => void;
  readonly suggestions: () => readonly string[];
}

function tabEnd(
  event: KeyboardEvent,
  end: (how: VaultEditEnd) => void,
): boolean {
  if (event.key !== "Tab") return false;
  event.preventDefault();
  end(event.shiftKey ? "previous" : "next");
  return true;
}

export function VaultEditor(props: VaultEditorProps) {
  if (LIST_TYPES.has(props.type)) return <ListEditor {...props} />;
  return <FieldEditor {...props} />;
}

function FieldEditor({
  type,
  labelId,
  draft,
  onDraft,
  onEnd,
  suggestions,
}: VaultEditorProps) {
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (el.type === "text" || el.type === "textarea")
      el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const text = type === "text";
  useValueSuggest(
    field,
    text
      ? {
          tags: false,
          values: suggestions,
          taken: () => [],
          pick: (value) => onEnd(true, { ...draft, text: value }, "stay"),
        }
      : null,
  );
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.defaultPrevented || composing(event)) return;
    if (tabEnd(event, (how) => onEnd(true, draft, how))) return;
    if (event.key === "Enter" && !(text && event.shiftKey)) {
      event.preventDefault();
      onEnd(true, draft, "stay");
    } else if (event.key === "Escape") {
      event.preventDefault();
      onEnd(false, draft, "stay");
    }
  };
  const shared = {
    "data-query-vault-input": "",
    "aria-labelledby": labelId,
    value: draft.text,
    onInput: (event: { currentTarget: { value: string } }) =>
      onDraft({ ...draft, text: event.currentTarget.value }),
    onKeyDown,
  };
  if (text)
    return (
      <textarea
        {...shared}
        ref={field}
        rows={1}
        className={cn(
          FIELD,
          "zt:field-sizing-content zt:max-h-75 zt:resize-none zt:overflow-y-auto zt:whitespace-pre-wrap",
        )}
      />
    );
  if (isDate(type))
    return (
      <input
        {...shared}
        ref={field}
        type={type === "date" ? "date" : "datetime-local"}
        max={type === "date" ? "9999-12-31" : "9999-12-31T23:59:59"}
        className={cn(FIELD, ONE_LINE, "zt:ps-7 zt:tabular-nums")}
      />
    );
  return (
    <input
      {...shared}
      ref={field}
      type="text"
      inputMode={type === "number" ? "decimal" : undefined}
      className={cn(
        FIELD,
        ONE_LINE,
        type === "number" && "zt:text-end zt:tabular-nums",
      )}
    />
  );
}

function ListEditor({
  type,
  labelId,
  draft,
  onDraft,
  onEnd,
  suggestions,
}: VaultEditorProps) {
  const field = useRef<HTMLInputElement>(null);
  const pills = useRef<(HTMLElement | null)[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const chipBox = useRef<HTMLSpanElement>(null);
  const chipField = useRef<HTMLInputElement>(null);
  const focusAfter = useRef<number | null>(null);
  const latest = useRef(draft);
  latest.current = draft;
  const chipEnded = useRef(false);
  const app = useObsidianApp();
  const editingAt = draft.chip?.at;
  useEditorScope(root);
  useLayoutEffect(() => {
    if (latest.current.chip === undefined)
      field.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const at = focusAfter.current;
    if (at === null) return;
    focusAfter.current = null;
    if (at >= 0) {
      pills.current[at]?.focus();
      return;
    }
    field.current?.focus();
    showAgain(field.current);
  });
  useLayoutEffect(() => {
    const box = chipBox.current;
    const el = root.current;
    const input = chipField.current;
    if (editingAt === undefined || !box || !el || !input) return;
    const style = getComputedStyle(el);
    const edge = el.getBoundingClientRect();
    const start = box.getBoundingClientRect();
    const room =
      style.direction === "rtl"
        ? start.right - edge.left - Number.parseFloat(style.paddingInlineEnd)
        : edge.right - Number.parseFloat(style.paddingInlineEnd) - start.left;
    box.style.setProperty("--zt-chip-room", `${Math.max(room, 0)}px`);
    chipEnded.current = false;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editingAt]);
  const add = (text: string) => onDraft(withPending({ ...draft, text }));
  const picked = useRef(false);
  useLayoutEffect(() => {
    if (!picked.current) return;
    picked.current = false;
    showAgain(field.current);
  });
  useValueSuggest(
    field,
    type === "aliases"
      ? null
      : {
          tags: type === "tags",
          values: suggestions,
          taken: () => draft.items,
          pick: (value) => {
            picked.current = true;
            add(value);
          },
        },
  );
  const focusPill = (at: number) => {
    if (at < 0) return;
    if (at >= draft.items.length) field.current?.focus();
    else pills.current[at]?.focus();
  };
  const focusNow = (at: number) =>
    (at < 0 ? field.current : pills.current[at])?.focus();
  const remove = (at: number, toField = false) => {
    const rest = withoutItem(latest.current, at);
    const next = withChip(rest);
    let before = toField ? -1 : at - 1;
    const emptied = next.items.length < rest.items.length;
    if (emptied && rest.chip && rest.chip.at <= before) before -= 1;
    chipEnded.current = true;
    if (before < 0) focusAfter.current = -1;
    else focusNow(before);
    onDraft(next);
  };
  const editChip = (at: number) => {
    const current = withChip(latest.current);
    const item = current.items[at];
    if (item !== undefined) onDraft({ ...current, chip: { at, text: item } });
  };
  const endChip = (keep: boolean) => {
    const at = latest.current.chip?.at;
    if (at === undefined) return;
    chipEnded.current = true;
    const next = keep ? withChip(latest.current) : withoutChip(latest.current);
    focusNow(next.items.length === latest.current.items.length ? at : at - 1);
    onDraft(next);
  };
  const onChipKey = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.defaultPrevented || composing(event)) return;
    if (tabEnd(event, end)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      endChip(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      endChip(false);
    }
  };
  const chipMenu = (
    chip: HTMLElement,
    pointer: MouseEvent | null,
    at: number,
  ) => {
    const menu = openChipMenu(chip, pointer?.nativeEvent ?? null, {
      item: draft.items[at] ?? "",
      edit: () => editChip(at),
      remove: () => remove(at),
    });
    if (menu) holdMenuKeys(menu, app.keymap);
  };
  const end = (how: VaultEditEnd) => onEnd(true, draft, how);
  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.defaultPrevented || composing(event)) return;
    if (tabEnd(event, end)) return;
    const el = event.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        if (draft.text.trim() !== "") add(draft.text);
        else end("stay");
        break;
      case "Escape":
        event.preventDefault();
        end("stay");
        break;
      case "Backspace":
      case "ArrowLeft":
        if (draft.text !== "" && !(event.key === "ArrowLeft" && atStart))
          return;
        event.preventDefault();
        focusPill(draft.items.length - 1);
        break;
    }
  };
  const onPillKey = (event: KeyboardEvent<HTMLElement>, at: number) => {
    event.stopPropagation();
    if (asksForMenu(event)) {
      event.preventDefault();
      chipMenu(event.currentTarget, null, at);
      return;
    }
    if (tabEnd(event, end)) return;
    const moves: Record<string, () => void> = {
      Backspace: () => remove(at),
      Delete: () => remove(at),
      ArrowLeft: () => focusPill(at - 1),
      ArrowRight: () => focusPill(at + 1),
      ArrowUp: () => focusPill(0),
      ArrowDown: () => field.current?.focus(),
      Escape: () => field.current?.focus(),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };
  return (
    <div
      ref={root}
      className={cn(CHIPS, "zt:whitespace-normal")}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        field.current?.focus();
      }}
    >
      {draft.items.map((item, at) => (
        <VaultChip
          key={at}
          item={item}
          tags={type === "tags"}
          chipRef={(el) => {
            pills.current[at] = el;
          }}
          tabIndex={-1}
          data-query-vault-chip={item}
          className={
            at === editingAt
              ? "zt:relative zt:[&>:not(:last-child)]:invisible"
              : undefined
          }
          onKeyDown={(event) => onPillKey(event, at)}
          onContextMenu={(event) => {
            if (at === editingAt) return;
            event.preventDefault();
            event.stopPropagation();
            chipMenu(event.currentTarget, event, at);
          }}
        >
          <span
            role="button"
            data-query-vault-chip-remove=""
            className="zt:flex zt:shrink-0 zt:cursor-(--cursor) zt:text-(--text-faint) zt:hover:text-(--text-normal)"
            {...tooltipAttrs(m.query_view_vault_remove_item({ item }))}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => remove(at, true)}
          >
            <Icon name="x" size="1em" />
          </span>
          {at === editingAt && draft.chip && (
            <span
              ref={chipBox}
              className="zt:absolute zt:inset-y-0 zt:start-0 zt:z-1 zt:flex zt:max-w-(--zt-chip-room) zt:min-w-full zt:rounded-(--radius-s) zt:bg-(--background-primary)"
            >
              <span
                className={cn(
                  PILL,
                  "zt:me-0 zt:max-w-none zt:flex-1 zt:ring-1 zt:ring-(--background-modifier-border-focus)",
                  type === "tags" && TAG,
                )}
              >
                <input
                  ref={chipField}
                  data-query-vault-chip-input=""
                  type="text"
                  aria-labelledby={labelId}
                  value={draft.chip.text}
                  className="zt:[field-sizing:content] zt:w-full zt:min-w-0 zt:bg-transparent zt:p-0 zt:outline-none"
                  onInput={(event) =>
                    onDraft({
                      ...draft,
                      chip: { at, text: event.currentTarget.value },
                    })
                  }
                  onKeyDown={onChipKey}
                  onBlur={(event) => {
                    if (chipEnded.current) return;
                    if (!root.current?.contains(event.relatedTarget)) return;
                    chipEnded.current = true;
                    onDraft(withChip(latest.current));
                  }}
                />
              </span>
            </span>
          )}
        </VaultChip>
      ))}
      <input
        data-query-vault-input=""
        type="text"
        ref={field}
        aria-labelledby={labelId}
        value={draft.text}
        className={cn(
          FIELD,
          "zt:inline-block zt:[field-sizing:content] zt:w-auto zt:max-w-full zt:min-w-16 zt:p-0",
        )}
        onInput={(event) =>
          onDraft({ ...draft, text: event.currentTarget.value })
        }
        onKeyDown={onFieldKey}
      />
    </div>
  );
}

function useEditorScope(root: RefObject<HTMLElement | null>): void {
  const app = useObsidianApp();
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const keys = holdScopeWhileFocused(el, new Scope(app.scope), {
      keymap: app.keymap,
    });
    return () => keys[Symbol.dispose]();
  }, [app, root]);
}

function holdMenuKeys(
  menu: Menu,
  keymap: Pick<App["keymap"], "pushScope" | "popScope">,
): void {
  menu.scope.register(null, null, () => false);
  const keys = new Scope(menu.scope);
  keys.register([], "Escape", () => {
    menu.hide();
    return false;
  });
  const hold = new Component();
  hold.onload = () => keymap.pushScope(keys);
  hold.onunload = () => keymap.popScope(keys);
  menu.addChild(hold);
}

export const PILL =
  "zt:me-(--size-2-2) zt:inline-flex zt:max-w-full zt:min-w-0 zt:items-center zt:gap-(--size-2-1) zt:rounded-(--radius-s) zt:bg-(--background-modifier-hover) zt:px-(--size-2-2) zt:py-px zt:leading-(--line-height-tight) zt:outline-none zt:focus-visible:ring-1 zt:focus-visible:ring-(--background-modifier-border-focus)";

export const TAG =
  "zt:border-(length:--tag-border-width) zt:border-(--tag-border-color) zt:bg-(--tag-background) zt:px-(--tag-padding-x) zt:py-(--tag-padding-y) zt:leading-none zt:font-(--tag-weight) zt:text-(color:--tag-color) zt:hover:bg-(--tag-background-hover) zt:rounded-(--tag-radius)";

function useTruncated(el: RefObject<HTMLElement | null>, text: string) {
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const label = el.current;
    if (!label) return;
    const observe = (win: Window) => {
      const next = new (win as Window & typeof window).ResizeObserver(() =>
        setTruncated(label.scrollWidth > label.clientWidth),
      );
      next.observe(label);
      return next;
    };
    let observer = observe(label.win);
    const stopMigration = label.onWindowMigrated((win) => {
      observer.disconnect();
      observer = observe(win);
    });
    return () => {
      stopMigration();
      observer.disconnect();
    };
  }, [el, text]);
  return truncated;
}

export function VaultChip({
  item,
  tags,
  chipRef,
  children,
  className,
  ...attrs
}: {
  readonly item: string;
  readonly tags: boolean;
  readonly chipRef?: Ref<HTMLSpanElement>;
  readonly children?: ReactNode;
  readonly className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "children"> & {
    readonly "data-query-vault-chip"?: string;
  }) {
  const label = useRef<HTMLSpanElement>(null);
  const text = tags ? tagText(item) : item;
  const truncated = useTruncated(label, text);
  return (
    <span
      {...attrs}
      ref={chipRef}
      className={cn(PILL, tags && TAG, className)}
      {...(truncated ? tooltipAttrs(text) : {})}
    >
      <span ref={label} className="zt:min-w-0 zt:truncate">
        {text}
      </span>
      {children}
    </span>
  );
}
