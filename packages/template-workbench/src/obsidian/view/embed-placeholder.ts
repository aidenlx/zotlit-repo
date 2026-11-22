import { parseLinktext, setIcon } from "obsidian";
import type { App, MarkdownPostProcessor, TFile } from "obsidian";

import { isDraftMarkdown } from "@zotlit/obsidian-kit/reading-view.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

function embeddedNote(
  app: App,
  linktext: string,
  sourcePath: string,
): { path: string; subpath: string; file: TFile | null } | null {
  const { path, subpath } = parseLinktext(linktext);
  const file = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
  if (file !== null)
    return file.extension === "md" ? { path, subpath, file } : null;
  return { path, subpath, file: null };
}

export function noteEmbedPlaceholders(app: App): MarkdownPostProcessor {
  return (el, ctx) => {
    if (!isDraftMarkdown(el)) return;
    for (const embed of el.querySelectorAll<HTMLElement>(
      ".internal-embed:not(.is-loaded)",
    )) {
      const linktext = embed.getAttribute("src");
      if (linktext === null) continue;
      const note = embeddedNote(app, linktext, ctx.sourcePath);
      if (note === null) continue;
      embed.replaceWith(placeholder(embed.ownerDocument, linktext, note));
    }
  };
}

function placeholder(
  doc: Document,
  linktext: string,
  note: { path: string; subpath: string; file: TFile | null },
): HTMLElement {
  const box = doc.createElement("div");
  box.className =
    "zt:my-2 zt:flex zt:flex-col zt:gap-1 zt:rounded-md zt:border-(length:--border-width) zt:border-solid zt:border-(--background-modifier-border) zt:px-3 zt:py-2 zt:text-sm zt:text-muted-foreground";
  box.dataset["previewEmbed"] = note.file === null ? "missing" : "found";
  const header = box.createDiv({
    cls: "zt:flex zt:flex-wrap zt:items-center zt:gap-x-2",
  });
  setIcon(
    header.createSpan({ cls: "zt:flex zt:shrink-0 zt:text-faint" }),
    note.file === null ? "file-question" : "file-text",
  );
  const name = note.file?.basename ?? (note.path || linktext);
  const target = note.subpath
    ? `${name} › ${note.subpath.replace(/^#\^?/, "").replaceAll("#", " › ")}`
    : name;
  header.createSpan({
    cls: "zt:[font-weight:var(--font-medium)] zt:text-foreground",
    text: target,
  });
  header.createSpan({ text: m.note_preview_embed_label() });
  box.createDiv({
    text:
      note.file === null
        ? m.note_preview_embed_missing({ name })
        : m.note_preview_embed_found({ path: note.file.path }),
  });
  return box;
}
