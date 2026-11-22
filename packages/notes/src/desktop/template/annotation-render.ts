import { basename } from "node:path";

import {
  buildAnnotationsTemplateData,
  formatAnnotationSubpath,
  narrowBaseDataToCiteItemData,
  withAnnotationCitation,
} from "@zotlit/db";
import type {
  AnnotationFileLinkAnchor,
  AnnotationResolvers,
  AnnotationSources,
  AnnotationTemplateContext,
  Attachment,
  CiteRef,
  CitationVariant,
  FallibleTemplateLink,
  TemplateAnnotation,
  TemplateParentItemData,
} from "@zotlit/db";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";
import { fileUrlLink } from "@zotlit/obsidian-desktop/markdown-link.ts";
import { creatorSummary } from "@zotlit/plugin-kernel/item-summary.ts";
import {
  commentToMarkdown,
  createCommentTurndown,
} from "@zotlit/plugin-kernel/turndown/comment.ts";
import type { AttachmentImportBatch } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";

export function attachmentFileLink(
  attachment: Attachment,
  ctx: AttachmentPathContext,
  anchor?: AnnotationFileLinkAnchor,
): FallibleTemplateLink {
  const abs = attachmentAbsPath(attachment, ctx);
  if (!abs) return () => null;
  const filename = basename(abs) || "attachment";
  return fileUrlLink(
    abs,
    filename,
    anchor ? formatAnnotationSubpath(anchor) : "",
  );
}

export function buildAnnotationResolvers(options: {
  zoteroPref: AttachmentPathContext;
  attachmentImport: Pick<AttachmentImportBatch, "decide" | "resolveLink">;
  annotationImageLink?: AnnotationResolvers["annotationImageLink"];
}): AnnotationResolvers {
  const dataDir = options.zoteroPref.dataDir;
  const baseAttachmentPath = options.zoteroPref.baseAttachmentPath;
  const { attachmentImport } = options;
  let commentTurndown: ReturnType<typeof createCommentTurndown> | null = null;

  return {
    filePath: (a) => attachmentAbsPath(a, { dataDir, baseAttachmentPath }),
    fileLink: (a, anchor) =>
      attachmentFileLink(a, { dataDir, baseAttachmentPath }, anchor),
    commentToMarkdown: (html) => {
      commentTurndown ??= createCommentTurndown(TurndownService);
      return commentToMarkdown(commentTurndown, html);
    },
    authorsShort: creatorSummary,
    annotationImageLink: (annotation) => {
      if (options.annotationImageLink)
        return options.annotationImageLink(annotation);
      const cachePath = resolveAnnotCachePath(annotation, {
        dataDir,
        groupID: annotation.groupID,
      });
      if (cachePath == null) return null;
      return attachmentImport.resolveLink({
        source: attachmentImport.decide(cachePath, "annotation-cache"),
        vaultName: `${annotation.key}.png`,
      });
    },
  };
}

interface AnnotationRenderers {
  render(name: "annotation", data: AnnotationTemplateContext): string;
  renderCitation(refs: readonly CiteRef[], variant: CitationVariant): string;
}

interface RenderAnnotationsOptions {
  template: AnnotationRenderers;
  zoteroPref: AttachmentPathContext;
  attachmentImport: Pick<AttachmentImportBatch, "decide" | "resolveLink">;
  renderAnnotation?: (data: AnnotationTemplateContext) => string;
  annotationImageLink?: AnnotationResolvers["annotationImageLink"];
}

export function renderAnnotationSources(
  sources: AnnotationSources,
  options: RenderAnnotationsOptions,
): Map<string, string> {
  const dataByKey = buildAnnotationsTemplateData(
    sources,
    annotationResolvers(options),
  );
  return renderTemplateData(dataByKey, options);
}

function annotationResolvers(
  options: RenderAnnotationsOptions,
): AnnotationResolvers {
  return buildAnnotationResolvers({
    zoteroPref: options.zoteroPref,
    attachmentImport: options.attachmentImport,
    annotationImageLink: options.annotationImageLink,
  });
}

function renderTemplateData(
  dataByKey: ReadonlyMap<string, TemplateAnnotation>,
  options: RenderAnnotationsOptions,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, data] of dataByKey) {
    const root = withAnnotationCitation(data, () =>
      annotationCitation(data.parentItem, data.pageLabel, options.template),
    );
    result.set(
      key,
      options.renderAnnotation?.(root) ??
        options.template.render("annotation", root),
    );
  }
  return result;
}

export function annotationCitation(
  parentItem: TemplateParentItemData | null,
  pageLabel: string | null,
  template: Pick<AnnotationRenderers, "renderCitation">,
): string | null {
  const refs = annotationCiteRefs(parentItem, pageLabel);
  return refs && template.renderCitation(refs, "main");
}

export function annotationCiteRefs(
  parentItem: TemplateParentItemData | null,
  pageLabel: string | null,
): readonly CiteRef[] | null {
  if (!parentItem?.citekey) return null;
  return [
    {
      citationKey: parentItem.citekey,
      item: narrowBaseDataToCiteItemData(parentItem, parentItem.citekey),
      label: "page",
      locator: pageLabel,
    },
  ];
}
