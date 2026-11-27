import type { NoteAnnotation } from "#core/note-import/note-marks.ts";
import type {
  ColorMarkKind,
  HighlightOptions,
} from "#core/note-import/turndown/color-mark.ts";
import { distinct } from "@std/collections";
import { Effect } from "effect";
import type TurndownService from "turndown";

import {
  annotationColorToName,
  attachmentToTemplateData,
  DEFAULT_LOCATOR_LABEL_SHORT,
  resolveCitedItem,
} from "@zotlit/db";
import type {
  Attachment,
  CitationItem,
  Item,
  ResolvedCiteRef,
  ZoteroRef,
} from "@zotlit/db";
import { attachmentAbsPath, parseAttachmentPath } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  AttachmentImportBatch,
  SourceOrigin,
} from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";
import { annotationOpenUri } from "@zotlit/zotero-types/uri";

import {
  findAnnotationParagraphs,
  parseAnnotation,
  parseCitation,
  parseEmbeddedCitations,
  parseEmbeddedItemSnapshots,
  parseNoteSchema,
} from "#core/note-import/note-marks.ts";
import {
  renderColorMark,
  renderHighlight,
} from "#core/note-import/turndown/color-mark.ts";
import {
  ANNOTATION_CALLOUT_ATTR,
  createNoteTurndown,
  createObsidianTurndown,
  encodeCalloutAttr,
} from "#core/note-import/turndown/index.ts";

export interface NoteParserDeps extends HighlightOptions {
  citedItems: ReadonlyMap<string, Item>;
  groupID: number | null;
  attachments: ReadonlyMap<string, Attachment>;
  citationMap: ReadonlyMap<string, string>;
  citationSnapshots: ReadonlyMap<string, Record<string, unknown>>;
  renderCite: RenderCite;
  pathContext: AttachmentPathContext;
  attachmentImport: Pick<AttachmentImportBatch, "decide" | "resolveLink">;
}

export type RenderCite = (items: readonly ResolvedCiteRef[]) => string;

export type ParseNoteDeps = Omit<
  NoteParserDeps,
  "citationMap" | "citationSnapshots"
> & {
  renderAnnotationParagraph?: (
    annotationKeys: readonly string[],
  ) => ReadonlyMap<string, string>;
};

export function createNoteParser(
  Turndown: typeof TurndownService,
  deps: NoteParserDeps,
): TurndownService {
  const highlightOptions: HighlightOptions = {
    useColoredHighlightSyntax: deps.useColoredHighlightSyntax,
    highlightMappings: deps.highlightMappings,
  };
  return createNoteTurndown(Turndown, {
    ...highlightOptions,
    annotationExcerpt: resolveAnnotationExcerpt(highlightOptions),
    citation: resolveCitation(deps),
    embeddedImage: resolveEmbeddedImage(deps),
  });
}

export function parseNote(
  Turndown: typeof TurndownService,
  html: string,
  deps: ParseNoteDeps,
): string {
  const root = new DOMParser().parseFromString(html, "text/html");
  const schema = parseNoteSchema(root);
  if (!schema.supported) {
    if (schema.version === null) {
      if (!root.body.hasChildNodes()) return "";
      const markdown = createObsidianTurndown(Turndown).turndown(root.body);
      Effect.runSyncWith(logServices)(
        Effect.logWarning(
          "Converted Plain HTML Child Note with basic formatting",
        ).pipe(
          Effect.annotateLogs({
            fallbackReason: schema.fallbackReason,
            markdownLength: markdown.length,
          }),
          withLogCategory("note-import", "note-parser"),
        ),
      );
      return markdown;
    }
    Effect.runSyncWith(logServices)(
      Effect.logWarning("Skipped legacy Zotero note").pipe(
        Effect.annotateLogs({
          schemaVersion: schema.version,
        }),
        withLogCategory("note-import", "note-parser"),
      ),
    );
    return m.note_parser_legacy_format_callout({ version: schema.version });
  }
  const { renderAnnotationParagraph, ...parserDeps } = deps;
  if (renderAnnotationParagraph) {
    subsumeAnnotationParagraphs(schema.container, renderAnnotationParagraph);
  }
  const unavailableImages =
    deps.pathContext.dataDir === null
      ? schema.container.querySelectorAll("img[data-attachment-key]").length
      : 0;
  if (unavailableImages > 0)
    Effect.runSyncWith(logServices)(
      Effect.logInfo(
        "Left out the images of a note; the online library holds no image files on this computer",
      ).pipe(
        Effect.annotateLogs({ images: unavailableImages }),
        withLogCategory("note-import", "note-parser"),
      ),
    );
  const td = createNoteParser(Turndown, {
    ...parserDeps,
    citationMap: parseEmbeddedCitations(schema.container),
    citationSnapshots: parseEmbeddedItemSnapshots(schema.container),
  });
  return td.turndown(schema.container);
}

export interface NoteReferences {
  citedIndexedKeys: string[];
  attachmentKeys: string[];
}

export function noteReferences(
  html: string,
  groupID: number | null,
): NoteReferences {
  const schema = parseNoteSchema(
    new DOMParser().parseFromString(html, "text/html"),
  );
  if (!schema.supported) return { citedIndexedKeys: [], attachmentKeys: [] };
  const citedIndexedKeys = [
    ...schema.container.querySelectorAll("span.citation[data-citation]"),
  ].flatMap((el) =>
    (parseCitation(el)?.citationItems ?? []).flatMap(({ ref }) =>
      ref ? [citedIndexedKey(ref, groupID)] : [],
    ),
  );
  const attachmentKeys = [
    ...schema.container.querySelectorAll("img[data-attachment-key]"),
  ].flatMap((el) => el.getAttribute("data-attachment-key") || []);
  return {
    citedIndexedKeys: distinct(citedIndexedKeys),
    attachmentKeys: distinct(attachmentKeys),
  };
}

export function citedIndexedKey(
  ref: ZoteroRef,
  groupID: number | null,
): string {
  return formatIndexedKey(
    ref.key,
    ref.libraryType === "group" && ref.groupID !== null ? ref.groupID : groupID,
  );
}

export function noteAnnotationKeys(html: string): string[] {
  const root = new DOMParser().parseFromString(html, "text/html");
  const schema = parseNoteSchema(root);
  return schema.supported
    ? distinct(
        [...findAnnotationParagraphs(schema.container)].map(
          (p) => p.annotationKey,
        ),
      )
    : [];
}

function subsumeAnnotationParagraphs(
  container: HTMLElement,
  render: (annotationKeys: readonly string[]) => ReadonlyMap<string, string>,
): void {
  const paragraphs = [...findAnnotationParagraphs(container)];
  if (paragraphs.length === 0) return;
  const callouts = render(
    distinct(paragraphs.map(({ annotationKey }) => annotationKey)),
  );
  for (const { paragraph, annotationKey } of paragraphs) {
    const raw = callouts.get(annotationKey);
    if (raw === undefined) continue;
    const callout = raw.replaceAll(/\n{3,}/g, "\n\n").trim();
    if (callout === "") continue;
    const sentinel = paragraph.ownerDocument.createElement("div");
    sentinel.setAttribute(ANNOTATION_CALLOUT_ATTR, encodeCalloutAttr(callout));
    sentinel.textContent = "\u200B";
    paragraph.replaceWith(sentinel);
  }
}

function resolveCitation(
  deps: NoteParserDeps,
): TurndownService.ReplacementFunction {
  return (_content, node) => {
    const el = node as Element;
    const info = parseCitation(el);
    if (!info) return el.outerHTML;
    const items = info.citationItems.map((item) => {
      const dbItem = item.ref
        ? deps.citedItems.get(citedIndexedKey(item.ref, deps.groupID))
        : undefined;
      const citationKey = resolveCitekey(item, dbItem, deps.citationMap);
      return {
        citationKey,
        item: resolveCitedItem(
          dbItem,
          findEmbeddedSnapshot(item, deps.citationSnapshots),
          citationKey,
        ),
        locator: item.locator ?? null,
        label: item.label ?? null,
        labelShort: pandocLocatorLabel(item.label),
        suppressAuthor: item.suppressAuthor ?? false,
        prefix: item.prefix ?? null,
        suffix: item.suffix ?? null,
      };
    });
    if (items.every((item) => item.citationKey === null)) return el.outerHTML;
    return deps.renderCite(items).trim();
  };
}

const PANDOC_LOCATOR_LABELS: Readonly<Record<string, string>> = {
  book: "bk.",
  chapter: "chap.",
  column: "col.",
  figure: "fig.",
  folio: "fol.",
  issue: "no.",
  line: "l.",
  note: "n.",
  opus: "op.",
  paragraph: "para.",
  part: "pt.",
  section: "sec.",
  "sub-verbo": "s.v.",
  verse: "v.",
  volume: "vol.",
};

function pandocLocatorLabel(label: string | undefined): string {
  if (label && Object.hasOwn(PANDOC_LOCATOR_LABELS, label)) {
    return PANDOC_LOCATOR_LABELS[label]!;
  }
  return DEFAULT_LOCATOR_LABEL_SHORT;
}

function resolveCitekey(
  item: CitationItem,
  dbItem: Item | undefined,
  embedded: ReadonlyMap<string, string>,
): string | null {
  const { ref } = item;
  if (dbItem && "citationKey" in dbItem.fields && dbItem.fields.citationKey) {
    return dbItem.fields.citationKey;
  }
  for (const uri of item.uris) {
    const fromEmbedded = embedded.get(uri);
    if (fromEmbedded) return fromEmbedded;
  }
  return ref ? `${ref.key}?` : null;
}

function findEmbeddedSnapshot(
  item: CitationItem,
  snapshots: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  for (const uri of item.uris) {
    const itemData = snapshots.get(uri);
    if (itemData) return itemData;
  }
  return undefined;
}

function resolveAnnotationExcerpt(
  options: HighlightOptions,
): TurndownService.ReplacementFunction {
  return (content, node) => {
    const el = node as Element;
    const info = parseAnnotation(el);
    if (!info) {
      Effect.runSyncWith(logServices)(
        Effect.logWarning("Invalid data-annotation payload").pipe(
          Effect.annotateLogs({
            raw: el.getAttribute("data-annotation")?.slice(0, 100),
          }),
          withLogCategory("note-import", "note-parser"),
        ),
      );
      return content;
    }
    const kind = el.classList.contains("underline") ? "underline" : "highlight";
    return renderAnnotationMark(info, content, {
      kind,
      ...options,
    });
  };
}

function resolveEmbeddedImage(
  deps: NoteParserDeps,
): TurndownService.ReplacementFunction {
  return (_content, node) => {
    const el = node as Element;
    const key = el.getAttribute("data-attachment-key");
    if (!key) return el.outerHTML;
    if (deps.pathContext.dataDir === null) return el.getAttribute("alt") ?? "";

    const attachment = deps.attachments.get(key);
    if (!attachment) {
      Effect.runSyncWith(logServices)(
        Effect.logWarning("Embedded image attachment not found").pipe(
          Effect.annotateLogs({ key }),
          withLogCategory("note-import", "note-parser"),
        ),
      );
      return el.outerHTML;
    }

    const sourcePath = attachmentAbsPath(attachment, deps.pathContext);
    if (!sourcePath) {
      Effect.runSyncWith(logServices)(
        Effect.logWarning("Embedded image attachment path is unresolved").pipe(
          Effect.annotateLogs({ key }),
          withLogCategory("note-import", "note-parser"),
        ),
      );
      return el.outerHTML;
    }

    const filename =
      attachmentToTemplateData(attachment).filename ?? attachment.key;
    const link = deps.attachmentImport.resolveLink({
      source: deps.attachmentImport.decide(
        sourcePath,
        attachmentPathOrigin(attachment),
      ),
      vaultName: `${attachment.key}-${filename}`,
    });
    return `!${link()}`;
  };
}

function attachmentPathOrigin(attachment: Attachment): SourceOrigin {
  const { kind } = parseAttachmentPath(
    attachment.path,
    attachment.linkMode,
    attachment.key,
  );
  switch (kind) {
    case "storage":
    case "linked-base":
    case "linked-absolute":
      return kind;
    case "linked-url":
    case "unknown":
      throw new Error(
        `Embedded image attachment has no resolvable origin: ${kind}`,
      );
  }
}

function renderAnnotationMark(
  info: NoteAnnotation,
  text: string,
  options: { kind: ColorMarkKind } & HighlightOptions,
): string {
  const { kind } = options;
  const color = info.color
    ? { raw: info.color, name: annotationColorToName(info.color) }
    : null;
  const mark =
    kind === "highlight"
      ? renderHighlight(text, color, options)
      : renderColorMark(kind, text, color);
  const href = annotationHref(info);
  return href ? `[${mark}](${href})` : mark;
}

function annotationHref(info: NoteAnnotation): string | null {
  const ref = info.attachment;
  if (!ref) return null;
  return annotationOpenUri({
    attachmentKey: ref.key,
    annotationKey: info.annotationKey,
    pageLabel: info.pageLabel ?? null,
    groupID: ref.libraryType === "group" ? ref.groupID : null,
  });
}
