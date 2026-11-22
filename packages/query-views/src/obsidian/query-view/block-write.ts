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
    const start = lineOffset(text, lineStart + 1);
    if (start === -1 || text.slice(start, start + previous.length) !== previous)
      throw new Error("The Query Block text changed since it rendered");
    return text.slice(0, start) + next + text.slice(start + previous.length);
  });
}
