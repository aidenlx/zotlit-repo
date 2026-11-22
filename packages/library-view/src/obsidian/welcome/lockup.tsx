import markSvg from "@brand/zotlit-mark-16.svg?raw";
import wordmarkSvg from "@brand/zotlit-wordmark.svg?raw";

import { cn } from "@zotlit/obsidian-kit/utils.ts";
import { brandPaths } from "@zotlit/plugin-kernel/brand.ts";
import type { BrandPaths } from "@zotlit/plugin-kernel/brand.ts";

const GLYPH_SCALE = 12 / 686;
const GLYPH_X = 19 - 29 * GLYPH_SCALE;

let paths: { mark: BrandPaths; glyphs: BrandPaths } | undefined;

function lockupPaths() {
  paths ??= { mark: brandPaths(markSvg), glyphs: brandPaths(wordmarkSvg, 1) };
  return paths;
}

const INK_FILL = {
  ink: "zt:fill-(--zt-brand-ink)",
  accent: "zt:fill-(--zt-brand-accent)",
};

export function ZotLitLockup({ className }: { className?: string }) {
  const { mark, glyphs } = lockupPaths();
  return (
    <svg
      viewBox="1 0 64 16"
      width={64}
      height={16}
      aria-hidden="true"
      focusable="false"
      data-welcome-lockup=""
      className={cn(
        "zt:block zt:shrink-0 zt:[--zt-brand-accent:#E8622C] zt:[--zt-brand-ink:#1E3A5F] zt:in-[.theme-dark]:[--zt-brand-accent:#F0793F] zt:in-[.theme-dark]:[--zt-brand-ink:#D8E2F0]",
        className,
      )}
    >
      {(["ink", "accent"] as const).map((ink) => (
        <g key={ink} className={INK_FILL[ink]}>
          {mark[ink].map((d) => (
            <path key={d} d={d} />
          ))}
          <g transform={`translate(${GLYPH_X} 14) scale(${GLYPH_SCALE})`}>
            {glyphs[ink].map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </g>
      ))}
    </svg>
  );
}
