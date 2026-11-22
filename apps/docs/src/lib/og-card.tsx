import { regex } from "arkregex";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { render } from "takumi-js";
import { googleFonts, subsetFonts } from "takumi-js/helpers";
import type { FetchLike, FontSubset } from "takumi-js/helpers";
import { Renderer } from "takumi-js/node";

import { cjkGlyph, textWidth } from "./cjk.ts";

const fetchFont: FetchLike = async (input, init) => {
  const attempts = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (attempt >= attempts || init?.signal?.aborted) throw error;
      await delay(250 * attempt);
    }
  }
};

const CJK_SERIF = "LXGW WenKai GB Screen";
const CJK_SANS = "Noto Sans SC";

const faceUrl = regex(`url\\(["']?\\./(?<file>[^"')]+)`);
const faceRange = regex("unicode-range:(?<range>[^;}]+)");

async function wenkaiSubsets(packageRoot: string): Promise<FontSubset[]> {
  const wenkaiCss = createRequire(resolve(packageRoot, "package.json")).resolve(
    "lxgw-wenkai-screen-web/lxgwwenkaigbscreen/result.css",
  );
  const css = await readFile(wenkaiCss, "utf8");
  return css
    .split("@font-face")
    .slice(1)
    .flatMap((face) => {
      const file = faceUrl.exec(face)?.groups.file;
      const range = faceRange.exec(face)?.groups.range;
      if (!file || !range) return [];
      const ranges = range.split(",").map((part): [number, number] => {
        const [start = "", end = start] = part
          .trim()
          .replace(/^U\+/i, "")
          .split("-");
        return [Number.parseInt(start, 16), Number.parseInt(end, 16)];
      });
      const name = `${CJK_SERIF} ${file}`;
      return [
        {
          name,
          subsetOf: CJK_SERIF,
          key: `${name}:400:normal`,
          weight: 400,
          style: "normal",
          ranges,
          data: async () => {
            const bytes = await readFile(resolve(dirname(wenkaiCss), file));
            return bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            );
          },
        },
      ];
    });
}

async function cjkSubsets(packageRoot: string): Promise<FontSubset[]> {
  const [serif, sans] = await Promise.all([
    wenkaiSubsets(packageRoot),
    googleFonts({
      families: [{ name: CJK_SANS, weight: [400, 500, 600] }],
      fetch: fetchFont,
      timeout: 30_000,
    }),
  ]);
  return [...serif, ...sans];
}

async function createRenderer(packageRoot: string): Promise<Renderer> {
  const [subsets, archivo] = await Promise.all([
    googleFonts({
      families: [
        { name: "Gelasio", weight: 500 },
        { name: "Inter", weight: [400, 800] },
        { name: "IBM Plex Mono", weight: [500, 600] },
      ],
      fetch: fetchFont,
      timeout: 30_000,
    }),
    readFile(resolve(packageRoot, "src/fonts/archivo-semibold-zotlit.woff2")),
  ]);

  const renderer = new Renderer();
  await Promise.all([
    renderer.registerFont({ name: "Archivo", data: archivo, weight: 600 }),
    ...subsets.map(async (subset) =>
      renderer.registerFont({
        name: subset.name,
        subsetOf: subset.subsetOf,
        weight: subset.weight,
        style: subset.style,
        data: await subset.data(),
      }),
    ),
  ]);
  return renderer;
}

export interface CardProps {
  kind: string;
  title: string;
  description?: string;
  meta: string;
  hero?: boolean;
}

function ZotLitMark() {
  return (
    <svg viewBox="0 0 24 24" width={28} height={28}>
      <path
        d="M4.82 3.5 H17 V7 L9.81 16.5 H20.5 V20 H4.92 A0.92 0.92 0 0 1 4 19.08 V17.14 A1.9 1.9 0 0 1 4.38 15.99 L11.19 7 H4.25 A0.25 0.25 0 0 1 4 6.75 V4.32 A0.82 0.82 0 0 1 4.82 3.5 Z"
        fill="#1E3A5F"
      />
      <path d="M17 3.5 H20.5 V16.5 L18.75 14.75 L17 16.5 Z" fill="#E8622C" />
    </svg>
  );
}

function titleSize(title: string, hero?: boolean) {
  if (hero) return "text-[150px]";
  const width = textWidth(title);
  if (cjkGlyph.test(title)) {
    if (width > 52) return "text-[64px]";
    return width > 36 ? "text-[72px]" : "text-[84px]";
  }
  return width > 44 ? "text-[72px]" : "text-[84px]";
}

function titleSetting(title: string) {
  return cjkGlyph.test(title)
    ? "leading-[1.2] tracking-[0px]"
    : "leading-[1.05] tracking-[-1px]";
}

function descriptionSetting(description: string) {
  return cjkGlyph.test(description)
    ? "text-[32px] leading-[1.45] max-w-[1000px]"
    : "text-[35px] leading-[1.4] max-w-[820px]";
}

function kindTracking(kind: string) {
  return cjkGlyph.test(kind) ? "tracking-[1px]" : "tracking-[5px]";
}

function OGCard({ kind, title, description, meta, hero }: CardProps) {
  return (
    <div tw="flex flex-col w-full h-full bg-[#f7f5f0] px-[84px] py-[72px] font-['Inter','Noto_Sans_SC']">
      <div tw="flex flex-col self-start">
        <div
          tw={`font-['IBM_Plex_Mono','Noto_Sans_SC'] font-semibold text-[30px] ${kindTracking(kind)} text-[#b9461a]`}
        >
          {kind.toUpperCase()}
        </div>
        <div tw="flex w-full h-[6px] mt-[18px] bg-[#E8622C]" />
      </div>

      <div tw="flex flex-col flex-1 justify-center py-[10px]">
        <div
          tw={`font-['Gelasio','LXGW_WenKai_GB_Screen'] font-medium ${titleSize(title, hero)} ${titleSetting(title)} text-[#1b2029] max-w-[1000px] text-balance`}
        >
          {title}
        </div>
        {description ? (
          <div
            tw={`font-['Inter','Noto_Sans_SC'] ${descriptionSetting(description)} text-[#1b2029] mt-[26px]`}
          >
            {description}
          </div>
        ) : null}
      </div>

      <div tw="flex flex-row items-center justify-between border-t-[4px] border-[#1b2029] pt-[24px]">
        <div tw="flex flex-row items-center leading-none">
          <ZotLitMark />
          <div tw="flex flex-row font-['Archivo'] font-semibold text-[32px] tracking-[-0.32px] ml-[8px]">
            <span tw="text-[#1E3A5F]">Zot</span>
            <span tw="text-[#E8622C]">Lit</span>
          </div>
        </div>
        <div tw="font-['IBM_Plex_Mono','Noto_Sans_SC'] font-medium text-[24px] text-[#1b2029]">
          {meta}
        </div>
      </div>
    </div>
  );
}

export type OgCardRenderer = (props: CardProps) => Promise<Uint8Array>;

export function createOgCardRenderer(packageRoot: string): OgCardRenderer {
  let renderer: Promise<Renderer> | undefined;
  let cjk: Promise<FontSubset[]> | undefined;
  const registered = new Map<string, Promise<unknown>>();

  return async (props) => {
    renderer ??= createRenderer(packageRoot);
    const ready = await renderer;
    const text = [
      props.kind.toUpperCase(),
      props.title,
      props.description,
      props.meta,
    ].join(" ");
    if (cjkGlyph.test(text)) {
      cjk ??= cjkSubsets(packageRoot);
      for (const subset of subsetFonts({ fonts: await cjk, source: text })) {
        if (!registered.has(subset.key))
          registered.set(
            subset.key,
            subset.data().then((data) =>
              ready.registerFont({
                name: subset.name,
                subsetOf: subset.subsetOf,
                weight: subset.weight,
                style: subset.style,
                data,
              }),
            ),
          );
      }
      await Promise.all(registered.values());
    }
    return render(<OGCard {...props} />, {
      renderer: ready,
      width: 1200,
      height: 630,
      format: "webp",
    });
  };
}
