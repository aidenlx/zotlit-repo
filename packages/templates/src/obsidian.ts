import { regex } from "arkregex";

export const MARKER_START = "%%zt-managed%%";
export const MARKER_END = "%%/zt-managed%%";

export function formatManagedRegion(content: string): string {
  const body = content.trim();
  return body
    ? `${MARKER_START}\n${body}\n\n${MARKER_END}`
    : `${MARKER_START}\n\n${MARKER_END}`;
}

export const managedRegionTransform =
  (contentTemplate: string) =>
  (name: string, output: string): string =>
    name === contentTemplate ? formatManagedRegion(output) : output;

const MANAGED_REGION = new RegExp(
  `${RegExp.escape(MARKER_START)}[\\s\\S]*?${RegExp.escape(MARKER_END)}`,
);
const MANAGED_REGION_GLOBAL = new RegExp(MANAGED_REGION, "g");

export interface ManagedRegionReplacement {
  content: string;
  replaced: boolean;
  duplicateCount: number;
}

export function replaceManagedRegion(
  content: string,
  region: () => string,
): ManagedRegionReplacement {
  const matches = content.match(MANAGED_REGION_GLOBAL) ?? [];
  const duplicateCount = Math.max(0, matches.length - 1);
  if (matches.length === 0) return { content, replaced: false, duplicateCount };
  const rendered = keepQueryBlocks(matches[0]!, region());
  return {
    content: content.replace(MANAGED_REGION, () => rendered),
    replaced: true,
    duplicateCount,
  };
}

const QUERY_BLOCK_LANGUAGE = "zotquery";

const OPENING_FENCE = regex(
  "^ {0,3}(?<fence>`{3,}|~{3,})[ \\t]*(?<info>[^\\n]*)$",
);

function closesFence(line: string, fence: string): boolean {
  const indent = line.length - line.trimStart().length;
  const body = line.trim();
  return (
    indent <= 3 &&
    body.length >= fence.length &&
    body === fence[0]!.repeat(body.length)
  );
}

function codeBlocks(
  lines: readonly string[],
): { start: number; end: number; language: string }[] {
  const blocks: { start: number; end: number; language: string }[] = [];
  for (let start = 0; start < lines.length; start++) {
    const open = OPENING_FENCE.exec(lines[start]!);
    if (!open) continue;
    const { fence, info } = open.groups;
    if (fence.startsWith("`") && info.includes("`")) continue;
    let end = start + 1;
    while (end < lines.length && !closesFence(lines[end]!, fence)) end++;
    blocks.push({ start, end, language: info.trim().split(/\s/)[0]! });
    start = end;
  }
  return blocks;
}

function keepQueryBlocks(previous: string, next: string): string {
  const queryBlocks = (lines: readonly string[]) =>
    codeBlocks(lines).filter(
      ({ language }) => language === QUERY_BLOCK_LANGUAGE,
    );
  const oldLines = previous.split("\n");
  const kept = queryBlocks(oldLines);
  if (kept.length === 0) return next;
  const lines = next.split("\n");
  const rendered = queryBlocks(lines);
  for (
    let index = Math.min(kept.length, rendered.length) - 1;
    index >= 0;
    index--
  ) {
    const from = kept[index]!;
    const to = rendered[index]!;
    lines.splice(
      to.start,
      to.end - to.start + 1,
      ...oldLines.slice(from.start, from.end + 1),
    );
  }
  return lines.join("\n");
}
