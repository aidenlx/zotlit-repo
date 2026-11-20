import "@zotlit/pdfjs/worker";
import type { HeadlessDocument, PdfEngine } from "@zotlit/pdf-reader";
import { createPdfEngine } from "@zotlit/pdf-reader";
import type { TextItem } from "@zotlit/pdf-reader/pdfjs";
import { PdfTextStructure } from "@zotlit/pdf-structure";
import { getDocument } from "@zotlit/pdfjs/lib";

import { readerPageSource } from "./text-structure.ts";

declare const __TEXT_STRUCTURE_TRIAL__: {
  readonly pdfs: Readonly<Record<TrialPdf, string>>;
  readonly files: Readonly<Record<string, string>>;
};

type TrialPdf =
  | "pdf-reader/mock-form.pdf"
  | "pdf-reader/mock-direct.pdf"
  | "sandve-2013/sandve-2013.pdf";

export interface TextStructureReport {
  readonly form: StructureSummary;
  readonly direct: StructureSummary;
  readonly sameStructure: boolean;
  readonly fontNames: Readonly<Record<TrialPdf, FontNameSummary>>;
  readonly requests: readonly string[];
}

interface StructureSummary {
  readonly chars: number;
  readonly text: string;
  readonly fontNames: readonly string[];
}

interface FontNameSummary {
  readonly pages: number;
  readonly chars: number;
  readonly resolved: number;
  readonly equal: number;
  readonly loadedNames: number;
  readonly engineResolved: number;
  readonly engineNames: number;
}

const requests: string[] = [];

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function fetchData(
  kind: "cmap" | "standard-font",
  filename: string,
): Promise<Uint8Array> {
  requests.push(`${kind}:${filename}`);
  return trialFile(kind, filename);
}

function trialFile(
  kind: "cmap" | "standard-font",
  filename: string,
): Uint8Array {
  const file = __TEXT_STRUCTURE_TRIAL__.files[`${kind}:${filename}`];
  if (file === undefined) throw new Error(`No PDF.js ${kind} file ${filename}`);
  return bytes(file);
}

function pdf(name: TrialPdf): Uint8Array {
  return bytes(__TEXT_STRUCTURE_TRIAL__.pdfs[name]);
}

function load(engine: PdfEngine, name: TrialPdf): Promise<HeadlessDocument> {
  return engine.load({ key: name, name, read: async () => pdf(name) });
}

async function structure(
  engine: PdfEngine,
  name: TrialPdf,
): Promise<{ summary: StructureSummary; json: string }> {
  await using document_ = await load(engine, name);
  const { chars } = await new PdfTextStructure(
    readerPageSource(document_),
  ).page(0);
  return {
    summary: {
      chars: chars.length,
      text: chars
        .slice(0, 40)
        .map((char) => char.c)
        .join(""),
      fontNames: [...new Set(chars.map((char) => char.fontName))],
    },
    json: JSON.stringify(chars),
  };
}

function textItems(items: readonly unknown[]): TextItem[] {
  return items.filter(
    (item): item is TextItem =>
      typeof item === "object" && item !== null && "str" in item,
  );
}

interface FontStore {
  readonly commonObjs: {
    has(name: string): boolean;
    get(name: string): unknown;
  };
}

function baseName(page: FontStore, loadedName: string): string | null {
  if (!page.commonObjs.has(loadedName)) return null;
  const font: unknown = page.commonObjs.get(loadedName);
  return typeof font === "object" &&
    font !== null &&
    "name" in font &&
    typeof font.name === "string"
    ? font.name
    : null;
}

async function fontNames(
  engine: PdfEngine,
  name: TrialPdf,
): Promise<FontNameSummary> {
  await using document_ = await load(engine, name);
  const task = getDocument({
    data: pdf(name),
    docBaseId: "oracle",
    fontExtraProperties: true,
    useWorkerFetch: false,
    cMapPacked: true,
    BinaryDataFactory: class {
      fetch({
        kind,
        filename,
      }: {
        readonly kind: string;
        readonly filename: string;
      }): Promise<Uint8Array> {
        return Promise.resolve(
          trialFile(kind === "cMapUrl" ? "cmap" : "standard-font", filename),
        );
      }
    },
  });
  await using stack = new AsyncDisposableStack();
  stack.adopt(task, (loading) => loading.destroy());
  const oracle = await task.promise;
  let chars = 0;
  let resolved = 0;
  let equal = 0;
  let loadedNames = 0;
  let engineResolved = 0;
  let engineNames = 0;
  for (let pageIndex = 0; pageIndex < oracle.numPages; pageIndex++) {
    const page = await document_.page(pageIndex);
    const content = await document_.textContent(pageIndex);
    if (!page || !content) throw new Error(`${name} is not current`);
    await page.getOperatorList();
    const oraclePage = await oracle.getPage(pageIndex + 1);
    await oraclePage.getOperatorList();
    const oracleItems = textItems(
      (await oraclePage.getTextContent({ includeChars: true })).items,
    );
    const items = textItems(content.items);
    if (items.length !== oracleItems.length) {
      throw new Error(`${name} page ${pageIndex} items differ`);
    }
    for (const [index, item] of items.entries()) {
      const oracleItem = oracleItems[index]!;
      const base = baseName(oraclePage, oracleItem.fontName);
      const engineBase = baseName(page, item.fontName);
      for (const char of item.chars ?? []) {
        chars++;
        if (base !== null) resolved++;
        if (char.fontName === base) equal++;
        if (char.fontName === item.fontName) loadedNames++;
        if (page.commonObjs.has(item.fontName)) engineResolved++;
        if (engineBase !== null) engineNames++;
      }
    }
  }
  return {
    pages: oracle.numPages,
    chars,
    resolved,
    equal,
    loadedNames,
    engineResolved,
    engineNames,
  };
}

export async function run(): Promise<TextStructureReport> {
  using engine = createPdfEngine({ idPrefix: "zotlit", fetchData });
  const form = await structure(engine, "pdf-reader/mock-form.pdf");
  const direct = await structure(engine, "pdf-reader/mock-direct.pdf");
  const engineRequests = [...new Set(requests)];
  const names: TrialPdf[] = [
    "pdf-reader/mock-form.pdf",
    "pdf-reader/mock-direct.pdf",
    "sandve-2013/sandve-2013.pdf",
  ];
  const summaries: [TrialPdf, FontNameSummary][] = [];
  for (const name of names) {
    summaries.push([name, await fontNames(engine, name)]);
  }
  return {
    form: form.summary,
    direct: direct.summary,
    sameStructure: form.json === direct.json,
    fontNames: Object.fromEntries(summaries) as Record<
      TrialPdf,
      FontNameSummary
    >,
    requests: engineRequests,
  };
}
