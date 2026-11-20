import type { PdfEngine } from "#/core/index.ts";
import type { FixturePdf } from "#test/fixtures.ts";

import { createPdfEngine } from "#/core/index.ts";
import { fetchRequests, testFetchData } from "#test/data.ts";
import { fixturePdf } from "#test/fixtures.ts";

export interface DocumentReport {
  readonly form: TextSummary;
  readonly direct: TextSummary;
  readonly sameChars: boolean;
  readonly cached: boolean;
  readonly retired: { readonly current: boolean; readonly text: boolean };
  readonly cmaps: string[];
}

interface TextSummary {
  readonly items: number;
  readonly withChars: number;
  readonly chars: number;
}

async function textOf(engine: PdfEngine, name: FixturePdf) {
  const loaded = await engine.load({
    key: name,
    name,
    read: async () => fixturePdf(name),
  });
  const content = await loaded.textContent(0);
  if (!content) throw new Error(`${name} has no current text`);
  const items = content.items.filter(
    (item) => "str" in item && item.str.trim() !== "",
  );
  const chars = items.map((item) =>
    "chars" in item ? (item.chars ?? []) : [],
  );
  return {
    loaded,
    content,
    chars,
    [Symbol.asyncDispose]: () => loaded[Symbol.asyncDispose](),
  };
}

function summary(chars: readonly (readonly unknown[])[]): TextSummary {
  return {
    items: chars.length,
    withChars: chars.filter((list) => list.length > 0).length,
    chars: chars.reduce((total, list) => total + list.length, 0),
  };
}

export async function run(): Promise<DocumentReport> {
  using engine = createPdfEngine({ idPrefix: "zpr", fetchData: testFetchData });
  const form = await textOf(engine, "pdf-reader/mock-form.pdf");
  await using direct = await textOf(engine, "pdf-reader/mock-direct.pdf");
  const cached = (await form.loaded.textContent(0)) === form.content;
  await form.loaded[Symbol.asyncDispose]();
  const retired = {
    current: form.loaded.current(),
    text: (await form.loaded.textContent(0)) !== null,
  };
  return {
    form: summary(form.chars),
    direct: summary(direct.chars),
    sameChars: JSON.stringify(form.chars) === JSON.stringify(direct.chars),
    cached,
    retired,
    cmaps: fetchRequests.filter((request) => request.startsWith("cmap:")),
  };
}
