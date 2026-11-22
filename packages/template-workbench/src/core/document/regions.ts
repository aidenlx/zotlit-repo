import type { LiquidRange } from "#core/language/liquid.ts";
import type { SyntaxNode } from "@lezer/common";
import { regex } from "arkregex";

import { TEMPLATE_SLOT_ROOTS } from "@zotlit/db";
import type { TemplateLanguage } from "@zotlit/templates/constants";

import type { WorkbenchSliceRange } from "./manifest-patch.ts";

import { etaParser } from "#core/language/eta-syntax.ts";
import { liquidRanges } from "#core/language/liquid.ts";

export interface AnnotationRenderSite {
  readonly call: WorkbenchSliceRange;
  readonly line: WorkbenchSliceRange | null;
}

export interface ManagedBlockRegion {
  readonly range: WorkbenchSliceRange;
  readonly open: WorkbenchSliceRange;
  readonly close: WorkbenchSliceRange;
}

export interface PartialRenderSite {
  readonly name: string;
  readonly arguments: string;
  readonly call: WorkbenchSliceRange;
  readonly nameRange: WorkbenchSliceRange;
}

export interface NoteRegions {
  readonly annotationCalls: readonly AnnotationRenderSite[];
  readonly managedBlock: ManagedBlockRegion | null;
}

const ANNOTATION_CALL_TAGS: readonly string[] = ["render", "render_annotation"];

const ANNOTATION_PARTIALS: readonly string[] = ['"annotation"', "'annotation'"];

const PARTIAL_CALL_TAGS: readonly string[] = ["render", "include"];

const ETA_PARTIAL_CALL = "include";

const ETA_CALL_OPEN = new RegExp(
  `^\\s*${RegExp.escape(ETA_PARTIAL_CALL)}\\s*\\(\\s*$`,
);

export const RESERVED_CALL_NAMES: readonly string[] = [
  ...Object.keys(TEMPLATE_SLOT_ROOTS),
  "citation",
];

const FENCE = regex("^ {0,3}(?<marker>`{3,}|~{3,})");

export function noteRegions(
  source: string,
  note: WorkbenchSliceRange,
): NoteRegions {
  const body = source.slice(note.from, note.to);
  const tags = callTags(body);
  const annotationCalls = tags.flatMap((range) => {
    if (range.kind !== "tag" || !isAnnotationCall(body, range)) return [];
    const call = { from: note.from + range.from, to: note.from + range.to };
    return [{ call, line: ownedLine(source, call) }];
  });
  return { annotationCalls, managedBlock: managedBlock(source, note, tags) };
}

export function partialCalls(
  source: string,
  region: WorkbenchSliceRange,
  language: TemplateLanguage = "liquid",
): readonly PartialRenderSite[] {
  return templateCalls(source, region, language).filter(
    ({ name }) => !RESERVED_CALL_NAMES.includes(name),
  );
}

export function templateCalls(
  source: string,
  region: WorkbenchSliceRange,
  language: TemplateLanguage = "liquid",
): readonly PartialRenderSite[] {
  const body = source.slice(region.from, region.to);
  const shift = ({ from, to }: WorkbenchSliceRange) => ({
    from: region.from + from,
    to: region.from + to,
  });
  if (language === "eta") {
    return etaPartialCalls(body).map((site) => ({
      ...site,
      call: shift(site.call),
      nameRange: shift(site.nameRange),
    }));
  }
  return callTags(body).flatMap((range) => {
    const named = partialCall(body, range);
    if (!named) return [];
    return [
      {
        ...named,
        call: shift(range),
        nameRange: shift(named.nameRange),
      },
    ];
  });
}

function callTags(body: string): readonly LiquidRange[] {
  const code = codeRanges(body);
  return liquidRanges(body).filter(
    (range) =>
      range.closed &&
      !code.some(({ from, to }) => from <= range.from && range.from < to),
  );
}

function partialCall(
  body: string,
  { from, to, kind, name }: LiquidRange,
): Pick<PartialRenderSite, "name" | "arguments" | "nameRange"> | null {
  if (kind !== "tag" || !PARTIAL_CALL_TAGS.includes(name)) return null;
  const tag = body.slice(from, to);
  const argument = tag.slice(tag.indexOf(name) + name.length).trimStart();
  const quote = argument[0];
  if (quote !== '"' && quote !== "'") return null;
  const end = argument.indexOf(quote, 1);
  if (end === -1) return null;
  const partial = argument.slice(1, end);
  if (partial.length === 0) return null;
  const open = from + tag.length - argument.length;
  return {
    name: partial,
    nameRange: { from: open + 1, to: open + 1 + partial.length },
    arguments: tagRest(argument.slice(end + 1)),
  };
}

function etaPartialCalls(body: string): PartialRenderSite[] {
  const code = codeRanges(body);
  const sites: PartialRenderSite[] = [];
  etaParser.parse(body).iterate({
    enter: (node) => {
      if (node.name !== "Tag") return true;
      const tag = node.node;
      if (
        tag.getChild("TagClose") === null ||
        code.some(({ from, to }) => from <= tag.from && tag.from < to)
      )
        return false;
      const named = etaIncludeCall(body, tag.getChild("TagContent"));
      if (named) sites.push({ ...named, call: { from: tag.from, to: tag.to } });
      return false;
    },
  });
  return sites;
}

function etaIncludeCall(
  body: string,
  content: SyntaxNode | null,
): Omit<PartialRenderSite, "call"> | null {
  if (!content) return null;
  const strings = content.getChildren("String");
  const quoted = strings[0];
  if (!quoted || !ETA_CALL_OPEN.test(body.slice(content.from, quoted.from)))
    return null;
  const close = etaCallClose(body, { from: quoted.to, to: content.to }, [
    ...strings,
    ...content.getChildren("BlockComment"),
  ]);
  if (close === null || body.slice(close + 1, content.to).trim().length > 0)
    return null;
  const name = body.slice(quoted.from + 1, quoted.to - 1);
  if (name.length === 0) return null;
  const rest = body.slice(quoted.to, close).trim();
  return {
    name,
    nameRange: { from: quoted.from + 1, to: quoted.to - 1 },
    arguments: rest.startsWith(",") ? rest.slice(1).trim() : rest,
  };
}

function etaCallClose(
  body: string,
  range: WorkbenchSliceRange,
  shielded: readonly SyntaxNode[],
): number | null {
  let depth = 1;
  for (let at = range.from; at < range.to; at++) {
    const token = shielded.find(({ from, to }) => from <= at && at < to);
    if (token) {
      at = token.to - 1;
      continue;
    }
    if (body[at] === "(") depth++;
    else if (body[at] === ")" && --depth === 0) return at;
  }
  return null;
}

function tagRest(rest: string): string {
  const close = rest.lastIndexOf("%}");
  const text = (close === -1 ? rest : rest.slice(0, close)).trimEnd();
  return (text.endsWith("-") ? text.slice(0, -1) : text).trim();
}

function isAnnotationCall(body: string, { from, to, name }: LiquidRange) {
  if (!ANNOTATION_CALL_TAGS.includes(name)) return false;
  if (name === "render_annotation") return true;
  const tag = body.slice(from, to);
  const argument = tag.slice(tag.indexOf(name) + name.length).trimStart();
  return ANNOTATION_PARTIALS.some((partial) => argument.startsWith(partial));
}

function managedBlock(
  source: string,
  note: WorkbenchSliceRange,
  tags: readonly LiquidRange[],
): ManagedBlockRegion | null {
  const structural = tags.filter((range) => range.kind === "structural");
  const open = structural.find((range) => range.name === "managed");
  const close = structural.find(
    (range) => range.name === "endmanaged" && open && range.from >= open.to,
  );
  if (!open || !close) return null;
  const shift = ({ from, to }: LiquidRange) => ({
    from: note.from + from,
    to: note.from + to,
  });
  const openRange = shift(open);
  const closeRange = shift(close);
  return {
    range: {
      from: ownedLine(source, openRange)?.from ?? openRange.from,
      to: ownedLine(source, closeRange)?.to ?? closeRange.to,
    },
    open: openRange,
    close: closeRange,
  };
}

function ownedLine(
  source: string,
  range: WorkbenchSliceRange,
): WorkbenchSliceRange | null {
  const from = source.lastIndexOf("\n", range.from - 1) + 1;
  const breakAt = source.indexOf("\n", range.to);
  const end = breakAt === -1 ? source.length : breakAt;
  const to = source[end - 1] === "\r" ? end - 1 : end;
  return /^[ \t]*$/.test(source.slice(from, range.from)) &&
    /^[ \t]*$/.test(source.slice(range.to, to))
    ? { from, to }
    : null;
}

function codeRanges(text: string): WorkbenchSliceRange[] {
  const ranges: WorkbenchSliceRange[] = [];
  let fence: { marker: string; from: number } | undefined;
  for (const line of lineRanges(text)) {
    const marker = FENCE.exec(text.slice(line.from, line.to))?.groups.marker;
    if (fence) {
      if (
        marker &&
        marker[0] === fence.marker[0] &&
        marker.length >= fence.marker.length
      ) {
        ranges.push({ from: fence.from, to: line.to });
        fence = undefined;
      }
    } else if (marker) {
      fence = { marker, from: line.from };
    } else {
      ranges.push(...codeSpans(text, line));
    }
  }
  if (fence) ranges.push({ from: fence.from, to: text.length });
  return ranges;
}

function* lineRanges(text: string): Generator<WorkbenchSliceRange> {
  let from = 0;
  while (from <= text.length) {
    const breakAt = text.indexOf("\n", from);
    const end = breakAt === -1 ? text.length : breakAt;
    yield { from, to: text[end - 1] === "\r" ? end - 1 : end };
    if (breakAt === -1) return;
    from = breakAt + 1;
  }
}

function codeSpans(
  text: string,
  line: WorkbenchSliceRange,
): WorkbenchSliceRange[] {
  const spans: WorkbenchSliceRange[] = [];
  let index = line.from;
  while (index < line.to) {
    const open = backtickRun(text, index, line.to);
    if (open === 0) {
      index += 1;
      continue;
    }
    let close = index + open;
    while (close < line.to) {
      const run = backtickRun(text, close, line.to);
      if (run === open) break;
      close += run === 0 ? 1 : run;
    }
    if (close >= line.to) return spans;
    spans.push({ from: index, to: close + open });
    index = close + open;
  }
  return spans;
}

function backtickRun(text: string, index: number, end: number): number {
  let length = 0;
  while (index + length < end && text[index + length] === "`") length += 1;
  return length;
}
