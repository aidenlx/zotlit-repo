/** @jsxImportSource preact */
import type { ReaderHost } from "#/core/host.ts";
import type { FindState } from "#/core/types.ts";
import type { ReaderStringKey } from "#/generated/strings.ts";
import { useAtomValue } from "@effect/atom-react";
import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import { Icon, IconButton } from "./controls.tsx";

import { useChrome } from "#/core/chrome/model.ts";

type FindOption = "highlightAll" | "matchDiacritics" | "entireWord";

const OPTIONS: readonly (readonly [FindOption, ReaderStringKey])[] = [
  ["highlightAll", "pdf_reader_highlight_all"],
  ["matchDiacritics", "pdf_reader_match_diacritics"],
  ["entireWord", "pdf_reader_whole_words"],
];

let panels = 0;

function countText(host: ReaderHost, find: FindState): string {
  const t = (...args: Parameters<ReaderHost["t"]>) => host.t(...args);
  if (find.phase === "not-found") return t("pdf_reader_find_not_found");
  const { result } = find;
  if (!result) return "";
  if (result.capped) {
    return t("pdf_reader_find_count_capped", {
      current: result.current,
      total: result.total,
    });
  }
  return t(
    result.total === 1 ? "pdf_reader_find_count_one" : "pdf_reader_find_count",
    { current: result.current, total: result.total },
  );
}

export function FindBar(): JSX.Element {
  const { host, actions, state, findInput: findInputRef } = useChrome();
  const { find } = useAtomValue(state);
  const inputRef = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState(false);
  const [panelId] = useState(() => `zpr-find-settings-${++panels}`);
  useLayoutEffect(() => {
    findInputRef.current = inputRef.current;
    return () => {
      findInputRef.current = null;
    };
  }, [findInputRef]);
  useLayoutEffect(() => {
    const element = inputRef.current;
    if (element && element.value !== find.query) element.value = find.query;
  }, [find.query]);
  useLayoutEffect(() => {
    if (!find.open) {
      setSettings(false);
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [find.open]);
  useLayoutEffect(() => {
    const window = bar.current?.ownerDocument.defaultView;
    if (!settings || !window) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const keep = bar.current?.querySelectorAll(
        "[data-zpr-part='find-settings'], [data-zpr-part='find-options']",
      );
      if ([...(keep ?? [])].some((element) => element.contains(target))) {
        return;
      }
      setSettings(false);
    };
    const timer = window.setTimeout(() =>
      window.addEventListener("pointerdown", outside, true),
    );
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", outside, true);
    };
  }, [settings]);
  return (
    <div
      ref={bar}
      data-zpr-part="find-bar"
      data-phase={find.phase}
      hidden={!find.open}
      className="zpr:group zpr:relative zpr:flex zpr:shrink-0 zpr:items-center zpr:gap-1 zpr:border-b zpr:border-border zpr:bg-background zpr:px-2 zpr:py-1 zpr:text-sm zpr:text-foreground"
    >
      <span className="zpr:relative zpr:flex zpr:min-w-0 zpr:flex-1 zpr:items-center">
        <input
          ref={inputRef}
          type="search"
          data-zpr-part="find-input"
          aria-label={host.t("pdf_reader_find_placeholder")}
          aria-invalid={find.phase === "not-found" ? "true" : undefined}
          placeholder={host.t("pdf_reader_find_placeholder")}
          spellcheck={false}
          className="zpr:min-w-0 zpr:flex-1"
          onInput={(event) =>
            actions.set({ find: { query: event.currentTarget.value } })
          }
          onKeyDown={(event) => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") {
              event.preventDefault();
              actions.command(event.shiftKey ? "find-previous" : "find-next");
            } else if (event.key === "Escape") {
              event.preventDefault();
              actions.command("escape");
            }
          }}
        />
        <span
          data-zpr-part="find-pending"
          className="zpr:hidden zpr:text-muted zpr:group-data-[phase=pending]:inline-flex zpr:animate-spin"
        >
          <Icon name="lucide-loader" />
        </span>
      </span>
      <IconButton
        icon="uppercase-lowercase-a"
        part="find-match-case"
        label={host.t("pdf_reader_match_case")}
        active={find.caseSensitive}
        onClick={() =>
          actions.set({ find: { caseSensitive: !find.caseSensitive } })
        }
      />
      <span
        role="status"
        aria-live="polite"
        aria-busy={find.phase === "pending" ? "true" : undefined}
        data-zpr-part="find-count"
        className="zpr:shrink-0 zpr:text-xs zpr:text-muted zpr:data-[phase=not-found]:text-error"
        data-phase={find.phase}
      >
        {countText(host, find)}
      </span>
      <IconButton
        icon="lucide-arrow-up"
        part="find-previous"
        label={host.t("pdf_reader_find_previous")}
        onClick={() => actions.command("find-previous")}
      />
      <IconButton
        icon="lucide-arrow-down"
        part="find-next"
        label={host.t("pdf_reader_find_next")}
        onClick={() => actions.command("find-next")}
      />
      <IconButton
        icon="lucide-sliders-horizontal"
        part="find-options"
        label={host.t("pdf_reader_find_options")}
        expanded={settings}
        controls={panelId}
        onClick={() => setSettings(!settings)}
      />
      <IconButton
        icon="lucide-x"
        part="find-close"
        label={host.t("pdf_reader_find_close")}
        onClick={() => actions.set({ find: { open: false } })}
      />
      {settings && (
        <div
          id={panelId}
          data-zpr-part="find-settings"
          className="zpr:absolute zpr:end-2 zpr:top-full zpr:z-10 zpr:mt-1 zpr:flex zpr:flex-col zpr:gap-1 zpr:rounded-md zpr:border zpr:border-border zpr:bg-surface zpr:p-2 zpr:shadow-md"
        >
          {OPTIONS.map(([option, label]) => (
            <label
              key={option}
              className="zpr:flex zpr:items-center zpr:gap-2 zpr:text-sm"
            >
              <input
                type="checkbox"
                data-zpr-option={option}
                checked={find[option]}
                onChange={(event) =>
                  actions.set({
                    find: { [option]: event.currentTarget.checked },
                  })
                }
              />
              {host.t(label)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
