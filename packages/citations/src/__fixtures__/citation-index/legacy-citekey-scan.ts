import type { Loc } from "obsidian";

import { scanPandocCitations } from "@zotlit/templates/pandoc-citation";

import type { CitationOccurrence } from "#obsidian/citation-index/scan.ts";

export function scanCitekeyOccurrences(text: string): CitationOccurrence[] {
  const lineStarts = lineStartsOf(text);
  const occurrences: CitationOccurrence[] = [];
  for (const citation of scanPandocCitations(citationBody(text))) {
    for (const { citationKey, start, end } of citation.items) {
      occurrences.push({
        kind: "citekey",
        raw: citationKey,
        position: {
          start: locAt(lineStarts, start),
          end: locAt(lineStarts, end),
        },
      });
    }
  }
  return occurrences;
}

const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/u;

const TAB_WIDTH = 4;

const CODE_INDENT = 4;

function citationBody(text: string): string {
  return maskWikilinks(maskExclusions(text));
}

function maskExclusions(text: string): string {
  const body = text.split("");
  maskBlocks(text, body);
  maskInline(body);
  return body.join("");
}

function mask(body: string[], from: number, to: number): void {
  for (let at = from; at < to; at += 1) {
    if (body[at] !== "\n") body[at] = " ";
  }
}

function maskBlocks(text: string, body: string[]): void {
  const lines = text.split("\n");
  const starts = lineStartsOf(text);
  const maskLine = (index: number): void => {
    mask(body, starts[index]!, starts[index]! + lines[index]!.length);
  };

  let from = 0;
  const frontmatterEnd = frontmatterLine(lines);
  if (frontmatterEnd !== null) {
    for (let line = 0; line <= frontmatterEnd; line += 1) maskLine(line);
    from = frontmatterEnd + 1;
  }

  let fence: string | null = null;
  let inCode = false;
  let afterBlank = true;
  let inList = false;
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (fence !== null) {
      maskLine(index);
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (isBlank(line)) {
      afterBlank = true;
      continue;
    }
    const indent = indentWidth(line);
    if (inCode && indent >= CODE_INDENT) {
      maskLine(index);
      continue;
    }
    inCode = false;

    const opening = openingFence(line);
    if (opening !== null) {
      maskLine(index);
      fence = opening;
    } else if (indent >= CODE_INDENT && afterBlank && !inList) {
      maskLine(index);
      inCode = true;
    } else if (LIST_MARKER.test(line)) {
      inList = true;
    } else if (indent === 0) {
      inList = false;
    }
    afterBlank = false;
  }
}

export function maskWikilinks(text: string): string {
  const body = text.split("");
  for (let at = 0; at < body.length; at += 1) {
    if (body[at] === "\\") {
      at += 1;
    } else if (body[at] === "[" && body[at + 1] === "[") {
      at = maskWikilink(body, at);
    }
  }
  return body.join("");
}

function maskInline(body: string[]): void {
  for (let at = 0; at < body.length; at += 1) {
    const char = body[at];
    if (char === "\\") {
      at += 1;
    } else if (char === "`") {
      at = maskCodeSpan(body, at);
    } else if (char === "%" && body[at + 1] === "%") {
      at = maskComment(body, at);
    } else if (char === "$") {
      at = maskMath(body, at);
    }
  }
}

function maskWikilink(body: string[], open: number): number {
  for (let at = open + 2; at < body.length - 1 && body[at] !== "\n"; at += 1) {
    if (body[at] !== "]" || body[at + 1] !== "]") continue;
    mask(body, open, at + 2);
    return at + 1;
  }
  return open + 1;
}

function maskCodeSpan(body: string[], open: number): number {
  let content = open;
  while (body[content] === "`") content += 1;
  const ticks = content - open;
  for (let at = content; at < body.length && body[at] !== "\n"; at += 1) {
    if (body[at] !== "`") continue;
    let end = at;
    while (body[end] === "`") end += 1;
    if (end - at === ticks) {
      mask(body, open, end);
      return end - 1;
    }
    at = end - 1;
  }
  return content - 1;
}

function maskComment(body: string[], open: number): number {
  for (let at = open + 2; at < body.length - 1; at += 1) {
    if (body[at] !== "%" || body[at + 1] !== "%") continue;
    mask(body, open, at + 2);
    return at + 1;
  }
  return open + 1;
}

function maskMath(body: string[], open: number): number {
  const display = body[open + 1] === "$";
  const content = open + (display ? 2 : 1);
  for (let at = content; at < body.length; at += 1) {
    if (body[at] === "\n" && !display) break;
    if (body[at] !== "$") continue;
    if (display) {
      if (body[at + 1] !== "$") continue;
      mask(body, open, at + 2);
      return at + 1;
    }
    if (at === content || isSpace(body[at - 1]!) || isDigit(body[at + 1])) {
      continue;
    }
    mask(body, open, at + 1);
    return at;
  }
  return content - 1;
}

function frontmatterLine(lines: readonly string[]): number | null {
  if (lines[0]?.trim() !== "---") return null;
  for (let line = 1; line < lines.length; line += 1) {
    if (lines[line]!.trim() === "---") return line;
  }
  return null;
}

function openingFence(line: string): string | null {
  const indent = leadingSpaces(line);
  if (indent > 3) return null;
  const char = line[indent];
  if (char !== "`" && char !== "~") return null;
  let end = indent;
  while (line[end] === char) end += 1;
  if (end - indent < 3) return null;
  if (char === "`" && line.includes("`", end)) return null;
  return line.slice(indent, end);
}

function closesFence(line: string, fence: string): boolean {
  const indent = leadingSpaces(line);
  if (indent > 3) return false;
  let end = indent;
  while (line[end] === fence[0]) end += 1;
  return end - indent >= fence.length && line.slice(end).trim() === "";
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function leadingSpaces(line: string): number {
  let at = 0;
  while (line[at] === " ") at += 1;
  return at;
}

function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += TAB_WIDTH;
    else break;
  }
  return width;
}

function isSpace(char: string): boolean {
  return /\s/u.test(char);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) {
    starts.push(at + 1);
  }
  return starts;
}

function locAt(lineStarts: readonly number[], offset: number): Loc {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineStarts[middle]! > offset) high = middle - 1;
    else low = middle;
  }
  return { line: low, col: offset - lineStarts[low]!, offset };
}
