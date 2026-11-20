import type { PdfEngineOptions } from "#/core/index.ts";

import { createPdfEngine } from "#/core/index.ts";
import { inlineBytes, testFetchData } from "#test/data.ts";
import { fixturePdf } from "#test/fixtures.ts";

const obsidianFonts = import.meta.glob<string>(
  "@obsidian-standard-fonts/*.{pfb,ttf}",
  { eager: true, query: "?inline", import: "default" },
);

export interface StandardFontsReport {
  readonly obsidianFiles: number;
  readonly requested: {
    readonly fork: readonly string[];
    readonly obsidian: readonly string[];
  };
  readonly differentFiles: readonly string[];
  readonly items: { readonly count: number; readonly equal: boolean };
  readonly pixels: {
    readonly width: number;
    readonly height: number;
    readonly inked: number;
    readonly differing: number;
  };
}

function filenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function obsidianFont(filename: string): Uint8Array {
  const file = Object.entries(obsidianFonts).find(
    ([path]) => filenameOf(path) === filename,
  );
  if (!file) throw new Error(`Obsidian has no standard font ${filename}`);
  return inlineBytes(file[1]);
}

function sameBytes(ours: Uint8Array, theirs: Uint8Array): boolean {
  return (
    ours.length === theirs.length &&
    ours.every((byte, index) => byte === theirs[index])
  );
}

function logged(
  log: string[],
  read: (
    kind: "cmap" | "standard-font",
    filename: string,
  ) => Uint8Array | Promise<Uint8Array>,
): PdfEngineOptions["fetchData"] {
  return async (kind, filename) => {
    log.push(`${kind}:${filename}`);
    return read(kind, filename);
  };
}

async function paint(options: PdfEngineOptions) {
  using engine = createPdfEngine(options);
  const document = await engine.load({
    key: "standard-fonts.pdf",
    name: "standard-fonts.pdf",
    read: async () => fixturePdf("pdf-reader/standard-fonts.pdf"),
  });
  try {
    const page = await document.page(0);
    const text = await document.textContent(0);
    if (!page || !text) throw new Error("The standard font page did not open");
    const viewport = page.getViewport({ scale: 2 });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context unavailable");
    return {
      width: canvas.width,
      height: canvas.height,
      data: context.getImageData(0, 0, canvas.width, canvas.height).data,
      items: JSON.stringify(
        text.items.map((item) =>
          "str" in item
            ? [item.str, item.transform, item.width, item.height, item.chars]
            : null,
        ),
      ),
      count: text.items.length,
    };
  } finally {
    await document[Symbol.asyncDispose]();
  }
}

export async function run(): Promise<StandardFontsReport> {
  const fork: string[] = [];
  const obsidian: string[] = [];
  const forked = await paint({
    idPrefix: "fork",
    fetchData: logged(fork, testFetchData),
  });
  const reused = await paint({
    idPrefix: "obsidian",
    fetchData: logged(obsidian, (kind, filename) =>
      kind === "standard-font"
        ? obsidianFont(filename)
        : testFetchData(kind, filename),
    ),
  });
  const differentFiles: string[] = [];
  for (const [path, data] of Object.entries(obsidianFonts)) {
    const filename = filenameOf(path);
    const ours = await testFetchData("standard-font", filename).catch(
      () => null,
    );
    if (!ours || !sameBytes(ours, inlineBytes(data))) {
      differentFiles.push(filename);
    }
  }
  let inked = 0;
  let differing = 0;
  for (let offset = 0; offset < forked.data.length; offset += 4) {
    if (forked.data[offset]! < 128) inked++;
    if (
      forked.data[offset] !== reused.data[offset] ||
      forked.data[offset + 1] !== reused.data[offset + 1] ||
      forked.data[offset + 2] !== reused.data[offset + 2] ||
      forked.data[offset + 3] !== reused.data[offset + 3]
    ) {
      differing++;
    }
  }
  return {
    obsidianFiles: Object.keys(obsidianFonts).length,
    requested: { fork, obsidian },
    differentFiles,
    items: { count: forked.count, equal: forked.items === reused.items },
    pixels: { width: forked.width, height: forked.height, inked, differing },
  };
}
