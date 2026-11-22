import type { Rect, StructuredPage, ZoteroChar } from "#chars.ts";
import type { PdfPosition } from "#sort-index.ts";
import type { RangeEnd, RangeStep } from "#text-selection.ts";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  ANNOTATIONS,
  ASSET_DIR,
  ATTACHMENTS,
  PARITY_PDFS,
} from "@zotlit/scripts/fixture/spec";
import {
  getPackageRoot,
  getWorkspaceRoot,
} from "@zotlit/scripts/package-roots";

import { structureChars } from "#chars.ts";
import { PdfTextStructure } from "#session.ts";
import { computeSortIndex } from "#sort-index.ts";
import { adjustRange, offsetsByRects, textRange } from "#text-selection.ts";

const run = promisify(execFile);

const packageRoot = getPackageRoot(import.meta.filename);

const PINNED_COMMITS = {
  ".": "22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c",
  reader: "132bb787937a540a09513415fd507654eb0e88f9",
  "reader/pdfjs/pdf.js": "f57fc80d1c07e4cdc50a767ae0b500b5272123b4",
} as const;

const git = (repository: string, ...args: string[]) =>
  run("git", ["-C", repository, ...args])
    .then(({ stdout }) => stdout.trim())
    .catch(() => null);

async function defaultCheckout(): Promise<string> {
  const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
  const commonDir = await git(
    workspaceRoot,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  );
  return join(
    commonDir ? dirname(commonDir) : workspaceRoot,
    "..",
    "zotero-10",
  );
}

const checkout =
  process.env.ZOTLIT_ZOTERO_CHECKOUT ?? (await defaultCheckout());

async function findCheckoutProblem(): Promise<string | null> {
  for (const [path, commit] of Object.entries(PINNED_COMMITS)) {
    const repository = join(checkout, path);
    const head = await git(repository, "rev-parse", "HEAD");
    if (head !== commit) {
      return `${repository} is at ${head ?? "no readable revision"}, not the pinned ${commit}`;
    }
    const dirty = await git(repository, "status", "--porcelain");
    if (dirty) {
      return `${repository} sits at the pinned ${commit} with uncommitted changes on top`;
    }
  }
  return null;
}

const checkoutProblem = await findCheckoutProblem();

const skip = checkoutProblem !== null;

describe("the golden oracle", () => {
  it("is a Zotero checkout pinned to the commits the port came from", (context) => {
    if (checkoutProblem) {
      context.skip(
        `${checkoutProblem}. Set ZOTLIT_ZOTERO_CHECKOUT to a zotero/zotero ` +
          "checkout whose submodules are initialised and pinned to the " +
          "commits PINNED_COMMITS names.",
      );
    }
    expect(checkoutProblem).toBeNull();
  });
});

interface OracleItem {
  readonly chars: readonly ZoteroChar[];
}

interface OraclePage {
  readonly viewBox: Rect;
  readonly items: readonly OracleItem[];
  readonly structured: readonly string[];
}

interface Oracle {
  readonly numPages: number;
  readonly catalogPageLabels: readonly string[] | null;
  readonly pageLabels: readonly string[];
  readonly pages: readonly OraclePage[];
}

const oracles = new Map<string, Promise<Oracle>>();

function askZotero(asset: string): Promise<Oracle> {
  const pending =
    oracles.get(asset) ??
    run(
      process.execPath,
      [
        "--import",
        join(packageRoot, "oracle/register.mjs"),
        join(packageRoot, "oracle/extract.mjs"),
        join(ASSET_DIR, asset),
      ],
      {
        env: { ...process.env, ZOTLIT_ZOTERO_CHECKOUT: checkout },
        maxBuffer: 512 * 1024 * 1024,
      },
    ).then(({ stdout }) => JSON.parse(stdout) as Oracle);
  oracles.set(asset, pending);
  return pending;
}

function zoteroChars(items: readonly OracleItem[]): ZoteroChar[] {
  return items
    .flatMap((item) => item.chars)
    .map((char) => ({ ...char, rect: [...char.rect] }));
}

const PDFS = [
  "rougier-2014/rougier-2014.pdf",
  "ioannidis-2005/ioannidis-2005.pdf",
  "sakimas-song/sakimas-song.pdf",
  ...PARITY_PDFS.map(({ asset }) => asset),
];

describe.skipIf(skip)("Structured Characters and Page Labels", () => {
  it.each(PDFS)(
    "match Zotero's Page Labels on %s",
    async (asset) => {
      const oracle = await askZotero(asset);
      const structure = new PdfTextStructure({
        numPages: oracle.numPages,
        getViewBox: (pageIndex) =>
          Promise.resolve(oracle.pages[pageIndex]!.viewBox),
        getChars: (pageIndex) =>
          Promise.resolve(zoteroChars(oracle.pages[pageIndex]!.items)),
        getCatalogPageLabels: () => Promise.resolve(oracle.catalogPageLabels),
      });

      expect(await structure.pageLabels()).toEqual(oracle.pageLabels);
    },
    180_000,
  );
});

describe.skipIf(skip)("the Sort Index", () => {
  it("reproduces every Sort Index Zotero wrote into the Fixture", async () => {
    const attachment = ATTACHMENTS.find(({ key }) => key === "RGRPDF24")!;
    type RecordedPdfAnnotation = (typeof ANNOTATIONS)[number] & {
      position: PdfPosition;
    };
    const recorded = ANNOTATIONS.filter(
      (annotation): annotation is RecordedPdfAnnotation =>
        annotation.parentItemID === attachment.itemID &&
        "pageIndex" in annotation.position,
    );
    const oracle = await askZotero(attachment.sourceAsset!);

    const computed = recorded.map(({ key, position }) => {
      const page = oracle.pages[position.pageIndex]!;
      const structured = structureChars(
        position.pageIndex,
        page.viewBox,
        zoteroChars(page.items),
      );
      return `${key} ${computeSortIndex(structured, position)}`;
    });

    expect(recorded.length).toBeGreaterThan(0);
    expect(computed).toEqual(
      recorded.map(({ key, sortIndex }) => `${key} ${sortIndex}`),
    );
  }, 180_000);
});

describe.skipIf(skip)("the parity PDFs the Fixture declares", () => {
  it.each(PARITY_PDFS)(
    "exercise the branches $branches",
    async ({ asset }) => {
      const [page] = (await askZotero(asset)).pages;
      const chars = structureChars(
        0,
        page!.viewBox,
        zoteroChars(page!.items),
      ).chars;

      const branches = new Set<string>();
      if (chars.length === 0) branches.add("no-text-layer");
      if (chars.some(({ rotation }) => rotation === 90))
        branches.add("rotation");
      if (chars.some(({ c, u }) => c.length > 1 && u.length === 1)) {
        branches.add("ligature");
      }
      const columnSplitX = 195;
      const columns = new Set(
        chars
          .filter(({ rotation }) => rotation === 0)
          .map(({ rect }) => (rect[0] < columnSplitX ? "left" : "right")),
      );
      if (columns.size === 2) branches.add("multi-column");

      expect([...branches].sort()).toEqual(
        PARITY_PDFS.find((pdf) => pdf.asset === asset)!.branches.toSorted(),
      );
    },
    180_000,
  );
});

const withTextLayer = () =>
  PDFS.filter(
    (asset) =>
      !PARITY_PDFS.some(
        (pdf) => pdf.asset === asset && pdf.branches.includes("no-text-layer"),
      ),
  );

interface ZoteroSelection {
  extractRange(options: {
    chars: readonly unknown[];
    pageIndex: number;
    anchor: number;
    head: number;
  }): { position: { rects: Rect[] }; text: string } | null;
  extractRangeByRects(options: {
    chars: readonly unknown[];
    pageIndex: number;
    rects: readonly Rect[];
  }): { from: number; to: number } | null;
  getSelectionRangesByPosition(
    pdfPages: Record<number, StructuredPage>,
    position: PdfPosition,
  ): ZoteroRange[];
  getReversedSelectionRanges(ranges: ZoteroRange[]): ZoteroRange[];
  getModifiedSelectionRanges(
    pdfPages: Record<number, StructuredPage>,
    ranges: ZoteroRange[],
    head: { pageIndex: number; rects: Rect[] } | RangeStep,
  ): ZoteroRange[];
}

interface ZoteroRange {
  anchorOffset: number;
  headOffset: number;
  anchor?: boolean;
  head?: boolean;
  collapsed?: boolean;
  position: { pageIndex: number; rects: Rect[] };
  text: string;
}

describe.skipIf(skip)("text ranges", () => {
  const pairs = (charCount: number) =>
    Array.from({ length: 40 }, (_, i) => [
      (i * 37) % (charCount + 1),
      (i * 91 + 13) % (charCount + 1),
    ]);

  it.each(withTextLayer())(
    "match Zotero's ranges on %s",
    async (asset) => {
      const zotero = (await import(
        /* @vite-ignore */ join(checkout, "reader/src/pdf/selection.js")
      )) as ZoteroSelection;
      const oracle = await askZotero(asset);
      const got: string[] = [];
      const want: string[] = [];

      for (const [pageIndex, page] of oracle.pages.entries()) {
        const { chars } = structureChars(
          pageIndex,
          page.viewBox,
          zoteroChars(page.items),
        );
        if (!chars.length) continue;
        for (const [anchor, head] of pairs(chars.length)) {
          const where = `${asset} page ${pageIndex} ${anchor}-${head}`;
          const expected = zotero.extractRange({
            chars,
            pageIndex,
            anchor: anchor!,
            head: head!,
          })!;
          const range = textRange(chars, anchor!, head!);
          got.push(`${where} ${JSON.stringify(range.rects)} ${range.text}`);
          want.push(
            `${where} ${JSON.stringify(expected.position.rects)} ${expected.text}`,
          );
          if (!range.rects.length) continue;

          const byRects = zotero.extractRangeByRects({
            chars,
            pageIndex,
            rects: range.rects,
          });
          got.push(
            `${where} ${JSON.stringify(offsetsByRects(chars, range.rects))}`,
          );
          want.push(
            `${where} ${JSON.stringify(byRects && { from: byRects.from, to: byRects.to })}`,
          );
        }
      }

      expect(got.length).toBeGreaterThan(0);
      expect(got).toEqual(want);
    },
    180_000,
  );
});

describe.skipIf(skip)("dragged range ends", () => {
  it.each(withTextLayer())(
    "match Zotero's pointer path on %s",
    async (asset) => {
      const zotero = (await import(
        /* @vite-ignore */ join(checkout, "reader/src/pdf/selection.js")
      )) as ZoteroSelection;
      const oracle = await askZotero(asset);
      const pages = oracle.pages.map((page, pageIndex) =>
        structureChars(pageIndex, page.viewBox, zoteroChars(page.items)),
      );
      const byIndex = new Map(pages.map((page) => [page.pageIndex, page]));
      const round = (rects: readonly Rect[]) =>
        JSON.stringify(rects.map((rect) => rect.map((v) => +v.toFixed(3))));
      const got: string[] = [];
      const want: string[] = [];

      for (const { pageIndex, chars } of pages) {
        if (chars.length < 2) continue;
        const next = byIndex.get(pageIndex + 1)?.chars ?? [];
        for (let i = 0; i < 12; i++) {
          const from = (i * 53) % (chars.length - 1);
          const to = Math.min(chars.length, from + 1 + ((i * 29) % 60));
          const position = {
            pageIndex,
            rects: textRange(chars, from, to).rects,
          };
          const targets = [
            ...[3, 17, 41].map((step) => ({
              pageIndex,
              char: chars[(from + i * step) % chars.length]!,
            })),
            ...(next.length
              ? [{ pageIndex: pageIndex + 1, char: next[i % next.length]! }]
              : []),
          ];
          for (const { pageIndex: on, char } of targets) {
            for (const [dx, dy] of [
              [0.2, 0.5],
              [0.8, 0.5],
              [1.4, -0.3],
            ] as const) {
              const [x1, y1, x2, y2] = char.rect;
              const x = x1 + (x2 - x1) * dx;
              const y = y1 + (y2 - y1) * dy;
              for (const end of ["start", "end"] as RangeEnd[]) {
                const expected = zoteroDrag(zotero, {
                  pages: Object.fromEntries(
                    [pageIndex, pageIndex + 1].flatMap((index) => {
                      const page = byIndex.get(index);
                      return page ? [[index, page]] : [];
                    }),
                  ),
                  position,
                  end,
                  head: { pageIndex: on, rects: [[x, y, x, y]] },
                });
                if (!expected) continue;
                const where = `${asset} page ${pageIndex} ${from}-${to} ${end} to ${on} ${x},${y}`;
                const adjusted = adjustRange(
                  { position, end, point: { pageIndex: on, x, y } },
                  byIndex,
                );
                const kept =
                  adjusted !== null &&
                  round(adjusted.rects) === round(position.rects);
                const shape = (rects: readonly Rect[], next: readonly Rect[]) =>
                  kept ? "" : `${round(rects)} ${round(next)} `;
                got.push(
                  `${where} ${adjusted && `${shape(adjusted.rects, adjusted.nextPageRects ?? [])}${adjusted.text}`}`,
                );
                want.push(
                  `${where} ${shape(expected.rects, expected.nextPageRects)}${expected.text}`,
                );
              }
            }
          }
        }
      }

      expect(got.length).toBeGreaterThan(0);
      expect(got).toEqual(want);
    },
    180_000,
  );
});

describe.skipIf(skip)("stepped range ends", () => {
  it.each(withTextLayer())(
    "match Zotero's key path on %s",
    async (asset) => {
      const zotero = (await import(
        /* @vite-ignore */ join(checkout, "reader/src/pdf/selection.js")
      )) as ZoteroSelection;
      const oracle = await askZotero(asset);
      const pages = oracle.pages.map((page, pageIndex) =>
        structureChars(pageIndex, page.viewBox, zoteroChars(page.items)),
      );
      const byIndex = new Map(pages.map((page) => [page.pageIndex, page]));
      const round = (rects: readonly Rect[]) =>
        JSON.stringify(rects.map((rect) => rect.map((v) => +v.toFixed(3))));
      const got: string[] = [];
      const want: string[] = [];

      for (const { pageIndex, chars } of pages) {
        if (chars.length < 2) continue;
        const spans = [
          [0, Math.min(chars.length, 7)],
          [Math.max(0, chars.length - 5), chars.length],
          ...Array.from({ length: 16 }, (_, i) => {
            const from = (i * 53) % (chars.length - 1);
            return [from, Math.min(chars.length, from + 1 + ((i * 29) % 60))];
          }),
        ];
        for (const [from, to] of spans) {
          const position = {
            pageIndex,
            rects: textRange(chars, from!, to!).rects,
          };
          for (const end of ["start", "end"] as RangeEnd[]) {
            for (const step of ["left", "right", "up", "down"] as const) {
              const expected = zoteroDrag(zotero, {
                pages: Object.fromEntries(
                  [pageIndex - 1, pageIndex, pageIndex + 1].flatMap((index) => {
                    const page = byIndex.get(index);
                    return page ? [[index, page]] : [];
                  }),
                ),
                position,
                end,
                head: step,
              });
              const adjusted = adjustRange({ position, end, step }, byIndex);
              const [reread] = zotero.getSelectionRangesByPosition(
                Object.fromEntries([[pageIndex, byIndex.get(pageIndex)!]]),
                position,
              );
              const said = (
                answer: {
                  rects: readonly Rect[];
                  nextPageRects?: readonly Rect[];
                  text: string;
                } | null,
              ) =>
                answer === null ||
                (!answer.nextPageRects?.length &&
                  (round(answer.rects) === round(position.rects) ||
                    round(answer.rects) ===
                      round(reread?.position.rects ?? [])))
                  ? "unchanged"
                  : `${round(answer.rects)} ${round(answer.nextPageRects ?? [])} ${answer.text}`;
              const where = `${asset} page ${pageIndex} ${from}-${to} ${end} ${step}`;
              got.push(`${where} ${said(adjusted)}`);
              want.push(`${where} ${said(expected)}`);
            }
          }
        }
      }

      expect(got.length).toBeGreaterThan(0);
      expect(got).toEqual(want);
    },
    180_000,
  );
});

function zoteroDrag(
  zotero: ZoteroSelection,
  {
    pages,
    position,
    end,
    head,
  }: {
    pages: Record<number, StructuredPage>;
    position: { pageIndex: number; rects: Rect[] };
    end: RangeEnd;
    head: { pageIndex: number; rects: Rect[] } | RangeStep;
  },
): { rects: Rect[]; nextPageRects: Rect[]; text: string } | null {
  let ranges = zotero.getSelectionRangesByPosition(pages, position);
  if (!ranges.length) return null;
  if (end === "start") ranges = zotero.getReversedSelectionRanges(ranges);
  const moved = zotero
    .getModifiedSelectionRanges(pages, ranges, head)
    .filter((range) => range.position.rects.length > 0)
    .toSorted((a, b) => a.position.pageIndex - b.position.pageIndex);
  const [first, second] = moved;
  if (
    !first ||
    first.collapsed ||
    first.position.pageIndex !== position.pageIndex
  )
    return null;
  const anchorRange = moved.find((range) => range.anchor);
  const headRange = moved.find((range) => range.head);
  if (
    anchorRange &&
    headRange &&
    (anchorRange.position.pageIndex === headRange.position.pageIndex
      ? end === "end"
        ? headRange.headOffset <= anchorRange.anchorOffset
        : headRange.headOffset >= anchorRange.anchorOffset
      : end === "end"
        ? headRange.position.pageIndex < anchorRange.position.pageIndex
        : headRange.position.pageIndex > anchorRange.position.pageIndex)
  )
    return null;
  return {
    rects: first.position.rects,
    nextPageRects: second?.position.rects ?? [],
    text: second ? `${first.text} ${second.text}` : first.text,
  };
}

describe.skipIf(skip)("the vendored port", () => {
  const marker = "// === verbatim upstream copy starts here ===\n";

  async function expectVerbatim(file: string, upstreamPath: string) {
    const vendored = await readFile(
      join(packageRoot, "src/vendor", file),
      "utf8",
    );
    const upstream = await readFile(join(checkout, upstreamPath), "utf8");

    const [header, ...body] = vendored.split(marker);
    expect(
      Object.values(PINNED_COMMITS).filter((commit) =>
        header!.includes(commit),
      ),
    ).toEqual(Object.values(PINNED_COMMITS));
    expect(body.join(marker)).toBe(upstream);
  }

  it("carries native-text-selection-map.js verbatim under its provenance header", () =>
    expectVerbatim(
      "native-text-selection-map.js",
      "reader/src/pdf/native-text-selection-map.mjs",
    ));

  it.each(["structure.js", "page-label.js", "util.js"] as const)(
    "carries %s verbatim under its provenance header",
    (file) =>
      expectVerbatim(file, `reader/pdfjs/pdf.js/src/core/module/${file}`),
  );
});
