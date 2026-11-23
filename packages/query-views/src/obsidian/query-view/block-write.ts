import { regex } from "arkregex";
import type { MarkdownPostProcessorContext, Vault } from "obsidian";

import { processLiveText } from "@zotlit/obsidian-kit/live-text.ts";
import type { LiveTextApp } from "@zotlit/obsidian-kit/live-text.ts";

export type BlockWriteApp = LiveTextApp & {
  vault: Pick<Vault, "getFileByPath">;
};

export interface RenderedBlock {
  readonly ctx: MarkdownPostProcessorContext;
  readonly el: HTMLElement;
}

export interface BlockEdit {
  readonly previous: string;
  readonly next: string;
}

const OPENING_FENCE = regex("^ {0,3}(?<fence>`{3,}(?=[^`]*$)|~{3,})");

function lineOffset(text: string, line: number): number {
  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return -1;
    offset = next + 1;
  }
  return offset;
}

export async function writeBlockCode(
  app: BlockWriteApp,
  { ctx, el }: RenderedBlock,
  { previous, next }: BlockEdit,
): Promise<void> {
  const info = ctx.getSectionInfo(el);
  if (info === null) throw new Error("The Query Block has no place in a note");
  const { replaceCode } = ctx;
  if (typeof replaceCode === "function") {
    replaceCode.call(ctx, next);
    return;
  }
  await writeBlockAt(
    app,
    { sourcePath: ctx.sourcePath, lineStart: info.lineStart },
    { previous, next },
  );
}

export interface BlockPlace {
  readonly sourcePath: string;
  readonly lineStart: number;
}

export async function writeBlockAt(
  app: BlockWriteApp,
  { sourcePath, lineStart }: BlockPlace,
  { previous, next }: BlockEdit,
): Promise<void> {
  const file = app.vault.getFileByPath(sourcePath);
  if (file === null) throw new Error(`No note at ${sourcePath}`);
  await processLiveText(app, file, (text) => {
    const changed = () =>
      new Error("The Query Block text changed since it rendered");
    const opening = lineOffset(text, lineStart);
    if (opening === -1) throw changed();
    const openingEnd = text.indexOf("\n", opening);
    if (openingEnd === -1) throw changed();
    const opener = text.slice(opening, openingEnd);
    const fence = OPENING_FENCE.exec(opener)?.groups.fence;
    if (fence === undefined) throw changed();

    const start = openingEnd + 1;
    const marker = RegExp.escape(fence.charAt(0));
    const closing = new RegExp(
      `(?<=^|\\n) {0,3}${RegExp.escape(fence)}${marker}*[ \\t]*(?=\\r?\\n|$)`,
    ).exec(text.slice(start));
    if (closing === null) throw changed();
    const close = start + closing.index;
    const newline = text[close - 2] === "\r" ? "\r\n" : "\n";
    const end = close === start ? start : close - newline.length;
    if (text.slice(start, end) !== previous) throw changed();

    const separator = close === start && next !== "" ? newline : "";
    return text.slice(0, start) + next + separator + text.slice(end);
  });
}
