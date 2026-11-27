import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import {
  useAnnotStore,
  useSetFilterQuery,
} from "@zotlit/annotations/obsidian/annot-view/store.ts";
import { SearchInput } from "@zotlit/obsidian-kit/components/obsidian/search-input.tsx";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import { datasetSpec } from "./datasets.ts";
import { useQueryViewState } from "./model.ts";
import type { QueryView } from "./view.tsx";

import { ToolbarButton } from "#obsidian/query-view/toolbar-button.tsx";

export interface SearchBar {
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  toggle: () => void;
  close: () => void;
}

export function useSearchBar(): SearchBar {
  const setQuery = useSetFilterQuery();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setQuery("");
    setOpen(false);
    buttonRef.current?.focus();
  };
  return {
    open,
    buttonRef,
    toggle: () => (open ? close() : setOpen(true)),
    close,
  };
}

export function SearchButton({ bar }: { bar: SearchBar }) {
  const { buttonRef, open, toggle } = bar;
  return (
    <ToolbarButton
      ref={buttonRef}
      icon="search"
      label={m.query_view_search()}
      aria-expanded={open}
      active={open}
      data-query-toolbar="search"
      onClick={toggle}
    />
  );
}

export function SearchRow({ view, bar }: { view: QueryView; bar: SearchBar }) {
  const dataset = useQueryViewState(view, (s) => s.view?.from);
  const query = useAnnotStore((s) => s.filterQuery);
  const setQuery = useSetFilterQuery();
  const inputRef = useRef<HTMLInputElement>(null);
  const nameId = useUniqueId();
  useLayoutEffect(() => {
    if (bar.open) inputRef.current?.focus({ preventScroll: true });
  }, [bar.open]);
  if (!bar.open) return null;
  return (
    <div
      className={cn(
        "zt:flex zt:shrink-0 zt:items-center zt:border-b-(length:--border-width) zt:border-(--table-border-color) zt:py-(--size-2-2) zt:ps-[var(--zt-query-toolbar-inset-start,var(--size-2-1))] zt:pe-[var(--zt-query-toolbar-inset-end,var(--size-2-1))] zt:in-[.print]:hidden",
        "zt:[--background-modifier-form-field-hover:transparent] zt:[--background-modifier-form-field:transparent] zt:[--input-border-width-focus:0px] zt:[--input-border-width:0px] zt:[--input-shadow:none]",
      )}
    >
      <SearchInput
        className="zt:grow"
        ref={inputRef}
        type="text"
        data-query-search=""
        aria-labelledby={nameId}
        value={query}
        onChange={setQuery}
        placeholder={datasetSpec(dataset).search()}
        clearLabel={m.query_view_clear_search()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          bar.close();
        }}
      />
      <span hidden id={nameId}>
        {m.query_view_search()}
      </span>
    </div>
  );
}
