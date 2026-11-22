import type { ProfileNotePreview } from "#desktop/note-feature/index.ts";
import { stringifyYaml } from "obsidian";

import { heading } from "@zotlit/obsidian-kit/dialog-frame.ts";

const CODE_CLASS =
  "zt:m-0 zt:font-mono zt:text-xs zt:leading-normal zt:whitespace-pre-wrap zt:break-words zt:select-text zt:text-foreground";

export function previewPanel(
  parent: HTMLElement,
  titles: {
    path: string;
    properties: string;
    body: string;
  },
): { set(preview: Omit<ProfileNotePreview, "create"> | undefined): void } {
  const panel = parent.createDiv({
    cls: "zt:flex zt:flex-col zt:gap-3 zt:rounded-md zt:border zt:border-border zt:bg-(--background-secondary) zt:p-3",
  });
  const block = (title: string, tag: "code" | "pre", cls?: string) => {
    const group = panel.createDiv({ cls: "zt:flex zt:flex-col zt:gap-1.5" });
    heading(group, title);
    return group.createEl(tag, { cls: [CODE_CLASS, cls ?? ""].join(" ") });
  };
  const path = block(titles.path, "code", "zt:break-all");
  const properties = block(titles.properties, "pre");
  const body = block(titles.body, "pre", "zt:max-h-72 zt:overflow-auto");
  return {
    set(preview) {
      path.setText(preview?.path ?? "");
      properties.setText(preview ? stringifyYaml(preview.properties) : "");
      body.setText(preview?.body ?? "");
    },
  };
}
