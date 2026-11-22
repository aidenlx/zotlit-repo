import { Effect } from "effect";
import { useLayoutEffect, useRef, useState } from "react";

import { PinnedPopover } from "@zotlit/obsidian-kit/components/pinned-popover.tsx";
import type { PinnedPopoverHandle } from "@zotlit/obsidian-kit/components/pinned-popover.tsx";
import { saveFile } from "@zotlit/obsidian-kit/file-save.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import { writeClipboardRichText } from "@zotlit/plugin-kernel/clipboard.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";
import { composing } from "@zotlit/ui";

import { useQueryViewState } from "./model.ts";
import { toCSV, toHTML, toTSV } from "./table.ts";
import type { QueryView } from "./view.tsx";

import {
  ToolbarButtonContent,
  toolbarButtonClass,
} from "#obsidian/query-view/toolbar-button.tsx";
import {
  PopoverAction,
  PopoverActions,
  PopoverSection,
  toolbarPopoverClass,
} from "#obsidian/query-view/toolbar-popover.tsx";

export async function copyResults(view: QueryView): Promise<void> {
  const table = view.table();
  try {
    await writeClipboardRichText({ html: toHTML(table), text: toTSV(table) });
    new BaseNotice(m.query_view_copied());
  } catch (error) {
    Effect.runSyncWith(logServices)(
      Effect.logWarning("The Query View could not copy its results").pipe(
        Effect.annotateLogs({ error }),
        withLogCategory("views", "query-view", "results"),
      ),
    );
    new BaseNotice(m.query_view_copy_failed());
  }
}

export function exportResults(view: QueryView): void {
  const name = view.state.getState().view?.name || m.query_view_results_menu();
  saveFile(
    new Blob([toCSV(view.table())], { type: "text/csv" }),
    `${name}.csv`,
  );
}

function CountText({ view }: { view: QueryView }) {
  const phase = useQueryViewState(view, (s) => s.phase);
  const results = useQueryViewState(view, (s) => s.results);
  if (phase === "loading")
    return <span data-query-count="">{m.query_view_loading()}</span>;
  if (!results) return null;
  const { count, matched, truncated } = results;
  return (
    <span
      className="zt:tabular-nums"
      data-query-count={count}
      data-query-matched={matched}
    >
      {truncated
        ? m.query_view_results_limited({ count: matched, shown: count })
        : m.query_view_results({ count })}
    </span>
  );
}

function LimitField({ view, close }: { view: QueryView; close: () => void }) {
  const limit = useQueryViewState(view, (s) => s.view?.limit);
  const [text, setText] = useState(limit === undefined ? "" : String(limit));
  const [invalid, setInvalid] = useState(false);
  const id = useUniqueId();
  return (
    <PopoverSection className="zt:px-(--size-4-2) zt:pt-(--size-4-1) zt:pb-(--size-4-2) zt:text-sm">
      <label htmlFor={id} className="zt:px-(--size-2-1) zt:py-(--size-2-2)">
        {m.query_view_limit()}
      </label>
      <input
        id={id}
        type="number"
        min={1}
        step={1}
        value={text}
        placeholder={m.query_view_limit_placeholder()}
        data-query-limit=""
        aria-invalid={invalid || undefined}
        className="zt:w-full zt:aria-invalid:[--background-modifier-border-focus:var(--background-modifier-error)] zt:aria-invalid:[--background-modifier-border-hover:var(--background-modifier-error)] zt:aria-invalid:[--background-modifier-border:var(--background-modifier-error)]"
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          if (next === "") {
            setInvalid(false);
            view.document.editView({ limit: undefined }, { typed: true });
            return;
          }
          const value = Number(next);
          const valid = Number.isInteger(value) && value > 0;
          setInvalid(!valid);
          if (valid) view.document.editView({ limit: value }, { typed: true });
        }}
        onKeyDown={(event) => {
          if (composing(event) || event.key !== "Enter") return;
          event.preventDefault();
          close();
        }}
      />
    </PopoverSection>
  );
}

export function ResultsMenu({ view }: { view: QueryView }) {
  const current = useQueryViewState(view, (s) => s.view);
  const phase = useQueryViewState(view, (s) => s.phase);
  const matched = useQueryViewState(view, (s) => s.results?.matched ?? 0);
  useQueryViewState(view, (s) => s.defaults);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const handle = useRef<PinnedPopoverHandle>(null);
  const popup = useRef<HTMLDivElement>(null);
  const close = () => handle.current?.hide();
  useLayoutEffect(() => {
    if (open)
      popup.current
        ?.querySelector<HTMLInputElement>("[data-query-limit]")
        ?.focus();
  }, [open]);
  if (!current) return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => handle.current?.toggle()}
        aria-expanded={open}
        data-query-results=""
        data-active={
          view.setByResearcher(current).limit !== undefined ? "" : undefined
        }
        data-open={open ? "" : undefined}
        className={cn(toolbarButtonClass, "zt:me-auto zt:shrink")}
      >
        <ToolbarButtonContent
          label={<CountText view={view} />}
          keepLabel
          labelClassName="zt:text-xs"
        />
      </button>
      <PinnedPopover
        ref={popup}
        anchor={button}
        handle={handle}
        data-query-results-popup=""
        onOpenChange={setOpen}
        className={cn(
          themeHook.chooser,
          toolbarPopoverClass,
          "zt:max-w-80 zt:min-w-60",
        )}
      >
        {open && (
          <>
            {view.can.limit && <LimitField view={view} close={close} />}
            <PopoverActions>
              {view.can.limit && (
                <PopoverAction
                  icon="rotate-ccw"
                  data-query-show-all=""
                  disabled={current.limit === undefined || phase !== "ready"}
                  className="zt:disabled:cursor-default zt:disabled:text-faint zt:disabled:hover:bg-transparent zt:disabled:[&_svg]:text-faint"
                  onClick={() => {
                    view.document.editView({ limit: undefined });
                    close();
                  }}
                >
                  {m.query_view_show_all({ count: matched })}
                </PopoverAction>
              )}
              <PopoverAction
                icon="copy"
                data-query-copy=""
                onClick={() => {
                  close();
                  void copyResults(view);
                }}
              >
                {m.query_view_copy()}
              </PopoverAction>
              <PopoverAction
                icon="file-down"
                data-query-export=""
                onClick={() => {
                  close();
                  exportResults(view);
                }}
              >
                {m.query_view_export_csv()}
              </PopoverAction>
            </PopoverActions>
          </>
        )}
      </PinnedPopover>
    </>
  );
}
