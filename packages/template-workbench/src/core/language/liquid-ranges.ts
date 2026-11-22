import { regex } from "arkregex";

import { MANAGED_BLOCK_TAG_NAMES } from "@zotlit/templates/constants";
export const STRUCTURAL_TAGS: readonly string[] = MANAGED_BLOCK_TAG_NAMES;

export interface LiquidRange {
  from: number;
  to: number;
  kind: "output" | "tag" | "structural" | "comment";
  name: string;
  closed: boolean;
  line?: boolean;
}

export function liquidCodeRange(
  source: string,
  position: number,
): LiquidRange | undefined {
  const range = liquidRanges(source).find(
    (r) => position > r.from + 1 && position <= (r.closed ? r.to - 2 : r.to),
  );
  if (!range) return undefined;
  if (range.name === "#") return { ...range, kind: "tag" };
  if (range.name === "comment") {
    const openerEnd = source.indexOf("%}", range.from);
    if (openerEnd < 0 || position <= openerEnd)
      return {
        ...range,
        to: openerEnd < 0 ? range.to : openerEnd + 2,
        kind: "tag",
      };
    const closerStart = source.lastIndexOf("{%", range.to - 1);
    return range.closed && position > closerStart + 1
      ? { ...range, from: closerStart, name: "endcomment", kind: "tag" }
      : undefined;
  }
  if (range.name !== "liquid") return range;
  const header = /^\{%-?\s*liquid\b/.exec(source.slice(range.from));
  if (!header || position <= range.from + header[0].length) return range;
  let block: "raw" | "comment" | undefined;
  const end = range.closed ? range.to - 2 : range.to;
  for (let from = range.from + header[0].length; from <= end;) {
    const newline = source.indexOf("\n", from);
    const to = Math.min(newline < 0 ? source.length : newline, end);
    const name =
      regex("^[\\t ]*(?<name>[\\w#]+)").exec(source.slice(from, to))?.groups
        .name ?? "";
    if (block && source.slice(from, to).trim() === `end${block}`)
      block = undefined;
    if (position <= to)
      return block
        ? undefined
        : { from, to, kind: "tag", name, closed: false, line: true };
    if (!block && (name === "raw" || name === "comment")) block = name;
    from = to + 1;
  }
  return undefined;
}

export function liquidRanges(source: string): LiquidRange[] {
  const result: LiquidRange[] = [];
  const start = /\{[{%]/g;
  while (true) {
    const match = start.exec(source);
    if (!match) break;
    const from = match.index;
    const output = match[0] === "{{";
    const close = output ? "}}" : "%}";
    const name = output
      ? ""
      : (regex("^\\{%-?\\s*(?<name>[\\w#]+)").exec(source.slice(from))?.groups
          .name ?? "");
    let quote = "";
    let to = from + 2;
    for (; to < source.length; to++) {
      const char = source[to];
      if (name === "#" || name === "liquid") {
        if (source.startsWith(close, to)) break;
      } else if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (source.startsWith(close, to)) break;
    }
    const closed = to < source.length;
    to = Math.min(to + 2, source.length);
    if (name === "raw" || name === "comment") {
      const end =
        name === "raw"
          ? /\{%-?\s*endraw\s*-?%}/g
          : /\{%-?\s*endcomment\s*-?%}/g;
      end.lastIndex = to;
      const ending = end.exec(source);
      if (name === "comment") {
        result.push({
          from,
          to: ending ? ending.index + ending[0].length : source.length,
          kind: "comment",
          name,
          closed: !!ending,
        });
      } else {
        result.push({ from, to, kind: "tag", name, closed });
        if (ending)
          result.push({
            from: ending.index,
            to: ending.index + ending[0].length,
            kind: "tag",
            name: "endraw",
            closed: true,
          });
      }
      start.lastIndex = ending
        ? ending.index + ending[0].length
        : source.length;
      continue;
    }
    result.push({
      from,
      to,
      kind: output
        ? "output"
        : STRUCTURAL_TAGS.includes(name)
          ? "structural"
          : name === "#"
            ? "comment"
            : "tag",
      name,
      closed,
    });
    start.lastIndex = to;
  }
  return result;
}
