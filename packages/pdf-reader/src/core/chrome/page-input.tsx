/** @jsxImportSource preact */
import { useAtomValue } from "@effect/atom-react";
import type { JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import { pageText, useChrome } from "#/core/chrome/model.ts";

export function pageIndexOf(
  value: string,
  labels: readonly string[] | null,
  pageCount: number,
): number | null {
  const trimmed = value.trim();
  if (labels) {
    const index = labels.indexOf(trimmed);
    if (index >= 0) return index;
  }
  if (!/^\d+$/.test(trimmed)) return null;
  const page = Number(trimmed);
  return page >= 1 && page <= pageCount ? page - 1 : null;
}

export function PageInput(): JSX.Element | null {
  const { host, actions, state, labels } = useChrome();
  const current = useAtomValue(state);
  const pageLabels = useAtomValue(labels);
  const input = useRef<HTMLInputElement>(null);
  const useLabels = current.showPageLabels && pageLabels !== null;
  const shown = pageText(pageLabels, useLabels, current.pageIndex);
  useLayoutEffect(() => {
    const element = input.current;
    if (element && element.ownerDocument.activeElement !== element) {
      element.value = shown;
    }
  }, [shown]);
  const committed = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const listener = () => committed.current();
    element.addEventListener("change", listener);
    return () => element.removeEventListener("change", listener);
  }, [useLabels, current.pageCount === 0]);
  if (current.pageCount === 0) return null;
  const commit = () => {
    const element = input.current;
    if (!element) return;
    const index = pageIndexOf(
      element.value,
      useLabels ? pageLabels : null,
      current.pageCount,
    );
    if (index === null) element.value = shown;
    else actions.goToPage(index);
  };
  committed.current = commit;
  const common = {
    ref: input,
    "data-zpr-part": "page-input",
    "aria-label": host.t("pdf_reader_page_number"),
    defaultValue: shown,
    className: "zpr:w-14 zpr:text-center",
    onClick: () => input.current?.select(),
    onBlur: () => {
      if (input.current) input.current.value = shown;
    },
  };
  return (
    <span className="zpr:flex zpr:shrink-0 zpr:items-center zpr:gap-1">
      {useLabels ? (
        <input key="label" type="text" {...common} />
      ) : (
        <input
          key="number"
          type="number"
          min={1}
          max={current.pageCount}
          {...common}
        />
      )}
      <span data-zpr-part="page-count" className="zpr:text-muted">
        {useLabels
          ? host.t("pdf_reader_page_label_count", {
              current: current.pageIndex + 1,
              total: current.pageCount,
            })
          : host.t("pdf_reader_page_count", { total: current.pageCount })}
      </span>
    </span>
  );
}
