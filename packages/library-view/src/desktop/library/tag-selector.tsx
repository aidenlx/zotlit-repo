import { useState } from "react";
import type { KeyboardEvent } from "react";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import type { LibraryTree } from "./library-tree.tsx";
import { useTreeState } from "./tree-model.ts";

import { TAG_CHIP_CLASS } from "#core/library/chip.ts";

export function shownTags(
  names: readonly string[],
  selected: readonly string[],
  filter: string,
): string[] {
  const needle = filter.trim().toLocaleLowerCase();
  return names.filter(
    (name) =>
      selected.includes(name) || name.toLocaleLowerCase().includes(needle),
  );
}

const STEPS: Readonly<Record<string, (at: number, last: number) => number>> = {
  ArrowRight: (at, last) => Math.min(at + 1, last),
  ArrowDown: (at, last) => Math.min(at + 1, last),
  ArrowLeft: (at) => Math.max(at - 1, 0),
  ArrowUp: (at) => Math.max(at - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

export function TagSelector({ tree }: { tree: LibraryTree }) {
  const names = useTreeState((s) => s.tagList);
  const selected = useTreeState((s) => s.tags);
  const filter = useTreeState((s) => s.tagFilter);
  const headingId = useUniqueId();
  const filterLabel = useUniqueId();
  const [current, setCurrent] = useState<string | null>(null);
  const shown = shownTags(names ?? selected, selected, filter);
  const stop = current !== null && shown.includes(current) ? current : shown[0];

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const name = shown[index]!;
    const step = STEPS[event.key];
    if (event.key === "Enter" || event.key === " ") tree.toggleTag(name);
    else if (step) {
      const to = step(index, shown.length - 1);
      setCurrent(shown[to]!);
      const tags =
        event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
          "[data-library-tag]",
        );
      tags?.[to]?.focus();
    } else return;
    event.preventDefault();
  };

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      data-library-tags=""
      className="zt:flex zt:flex-col zt:gap-(--size-2-2) zt:border-t-(length:--border-width) zt:border-(--background-modifier-border) zt:pt-(--size-4-2)"
    >
      <div className="zt:flex zt:items-baseline zt:justify-between zt:gap-(--size-2-2) zt:px-(--size-4-2)">
        <div
          id={headingId}
          aria-hidden="true"
          className="zt:text-(length:--font-ui-smaller) zt:font-(--font-semibold) zt:text-muted-foreground"
        >
          {m.library_view_tags_label()}
        </div>
        {selected.length > 0 && (
          <div
            role="button"
            tabIndex={0}
            data-library-tags-clear=""
            className="zt:cursor-(--cursor) zt:rounded-(--radius-s) zt:text-(length:--font-ui-smaller) zt:text-muted-foreground zt:outline-hidden zt:hover:text-(--text-normal) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]"
            onClick={() => tree.clearTags()}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              tree.clearTags();
            }}
          >
            {m.library_view_tags_clear()}
          </div>
        )}
      </div>
      <div className="zt:flex zt:max-h-56 zt:flex-wrap zt:content-start zt:gap-(--size-2-2) zt:overflow-y-auto zt:p-(--size-2-1) zt:px-(--size-4-2)">
        {shown.map((name, index) => (
          <div
            key={name}
            role="button"
            tabIndex={name === stop ? 0 : -1}
            data-library-tag={name}
            aria-pressed={selected.includes(name)}
            className={TAG_CHIP_CLASS}
            onClick={() => {
              setCurrent(name);
              tree.toggleTag(name);
            }}
            onFocus={() => setCurrent(name)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {name}
          </div>
        ))}
        {names !== null && shown.length === 0 && (
          <span
            data-library-tags-empty=""
            className="zt:text-(length:--font-ui-smaller) zt:text-muted-foreground"
          >
            {filter.trim() === ""
              ? m.library_view_tags_none()
              : m.library_view_tags_no_match()}
          </span>
        )}
      </div>
      <div className="zt:px-(--size-4-2)">
        <span id={filterLabel} className="zt:sr-only">
          {m.library_view_tags_filter()}
        </span>
        <input
          type="text"
          data-library-tags-filter=""
          aria-labelledby={filterLabel}
          placeholder={m.library_view_tags_filter()}
          value={filter}
          className="zt:w-full"
          onChange={(event) => tree.setTagFilter(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || filter === "") return;
            event.preventDefault();
            event.stopPropagation();
            tree.setTagFilter("");
          }}
        />
      </div>
    </div>
  );
}
