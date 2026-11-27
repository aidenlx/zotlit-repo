import type { PreparedText } from "@chenglou/pretext";
import { clearCache, layout, prepare } from "@chenglou/pretext";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { yieldToMain } from "@zotlit/plugin-kernel/yield-to-main.ts";

export interface ListMetrics {
  readonly font: string;
  readonly lineHeight: number;
  readonly width: number;
  readonly indent: number;
  readonly padding: number;
}

export interface RowText {
  readonly first: string;
  readonly rest: readonly string[];
}

export interface PreparedRow {
  readonly first: PreparedText;
  readonly rest: readonly PreparedText[];
}

export function prepareRow(text: RowText, font: string): PreparedRow {
  return {
    first: prepare(text.first, font),
    rest: text.rest.map((line) => prepare(line, font)),
  };
}

export function rowHeight(row: PreparedRow, metrics: ListMetrics): number {
  const { lineHeight, width, indent, padding } = metrics;
  const block = (text: PreparedText, at: number) =>
    Math.max(layout(text, at, lineHeight).height, lineHeight);
  return (
    padding +
    block(row.first, width) +
    row.rest.reduce((sum, text) => sum + block(text, width - indent), 0)
  );
}

export function sameMetrics(a: ListMetrics | null, b: ListMetrics | null) {
  if (a === null || b === null) return a === b;
  const near = (x: number, y: number) => Math.abs(x - y) < 0.01;
  return (
    a.font === b.font &&
    near(a.lineHeight, b.lineHeight) &&
    near(a.width, b.width) &&
    near(a.indent, b.indent) &&
    near(a.padding, b.padding)
  );
}

const PREPARE_BATCH = 250;

export function useRowHeights(
  texts: readonly (RowText | null)[],
  metrics: ListMetrics | null,
  doc: Document | null,
): readonly (number | null)[] | null {
  const font = metrics?.font ?? null;
  const [fonts, setFonts] = useState(0);
  useLayoutEffect(() => {
    if (!doc) return;
    const loaded = () => {
      clearCache();
      setFonts((count) => count + 1);
    };
    doc.fonts.addEventListener("loadingdone", loaded);
    return () => doc.fonts.removeEventListener("loadingdone", loaded);
  }, [doc]);

  const [prepared, setPrepared] = useState<{
    texts: readonly (RowText | null)[];
    font: string;
    fonts: number;
    rows: readonly (PreparedRow | null)[];
  } | null>(null);
  useEffect(() => {
    if (font === null) return;
    let stopped = false;
    void (async () => {
      const rows: (PreparedRow | null)[] = [];
      for (let at = 0; at < texts.length; at += PREPARE_BATCH) {
        if (at > 0) await yieldToMain();
        if (stopped) return;
        for (const text of texts.slice(at, at + PREPARE_BATCH))
          rows.push(text && prepareRow(text, font));
      }
      if (!stopped) setPrepared({ texts, font, fonts, rows });
    })();
    return () => {
      stopped = true;
    };
  }, [texts, font, fonts]);

  return useMemo(() => {
    if (
      metrics === null ||
      prepared === null ||
      prepared.texts !== texts ||
      prepared.font !== metrics.font ||
      prepared.fonts !== fonts
    )
      return null;
    return prepared.rows.map((row) => row && rowHeight(row, metrics));
  }, [prepared, texts, metrics, fonts]);
}
