import markSvg from "@brand/zotlit-mark-16.svg?raw";

import { brandPaths } from "@zotlit/plugin-kernel/brand.ts";

export const ZOTLIT_MARK_ICON = "zotlit-mark";

export function zotlitMarkSvg(): string {
  const { ink, accent } = brandPaths(markSvg);
  const paths = [...ink, ...accent].map((d) => `<path d="${d}"/>`).join("");
  return `<g transform="scale(6.25)" fill="currentColor">${paths}</g>`;
}
