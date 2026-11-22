import { stringify as stringifyYaml } from "yaml";

import {
  citekeysToCiteTemplateData,
  CONTRACT_VERSION,
  narrowBaseDataToCiteItemData,
  withAnnotationCitation,
} from "@zotlit/db";
import type { AnnotationTemplateContext, TemplateAnnotation } from "@zotlit/db";
import { restoreTemplateData } from "@zotlit/notes/core/template-preview/restore-template-data.ts";
import book from "@zotlit/notes/core/template-preview/samples/book.json" with { type: "json" };
import conferencePaper from "@zotlit/notes/core/template-preview/samples/conference-paper.json" with { type: "json" };
import journalArticle from "@zotlit/notes/core/template-preview/samples/journal-article.json" with { type: "json" };
import thesis from "@zotlit/notes/core/template-preview/samples/thesis.json" with { type: "json" };
import { renderFailureSpan } from "@zotlit/notes/core/template/render-failure.ts";
import type { RenderCallerSource } from "@zotlit/notes/core/template/render-failure.ts";
import {
  engineEvidence,
  errorChain,
} from "@zotlit/notes/core/template/render-report.ts";
import {
  inlineCitation,
  replaceSuffixMarkers,
  resolveNoteRelPath,
} from "@zotlit/templates";
import { TemplateFacade } from "@zotlit/templates/facade";
import type { ManagedFrontmatterEntry } from "@zotlit/templates/facade";
import {
  evalManagedFrontmatterEntries,
  FrontmatterJsonEError,
} from "@zotlit/templates/frontmatter";
import type { ManagedFrontmatterEvaluationError } from "@zotlit/templates/frontmatter";
import {
  FRONTMATTER_ABSENT,
  mergeManagedFrontmatterEntries,
} from "@zotlit/templates/frontmatter-merge";
import type { EvaluatedFrontmatterField } from "@zotlit/templates/frontmatter-merge";
import { replaceManagedRegion } from "@zotlit/templates/obsidian";
import type { ItemSnapshot } from "@zotlit/zotero-reads/contract/snapshot/types.ts";

import { renderFailureDiagnosticWithCallSite } from "./call-attribution.ts";
import type { RenderOptions } from "./request.ts";
import { failedRender, renderIdentity } from "./result.ts";
import type {
  SliceSite,
  TemplateRenderResult,
  RenderDiagnostic,
  RenderedProperty,
  RenderedRange,
} from "./result.ts";

export {
  CITATION_EXAMPLE_IDS,
  CITATION_EXAMPLE_ITEM,
  citationExampleData,
  DEFAULT_CITATION_EXAMPLE,
  isCitationExampleId,
  sampleItemCitation,
} from "@zotlit/notes/core/template-preview/citation-examples.ts";
export type { CitationExampleId } from "@zotlit/notes/core/template-preview/citation-examples.ts";
export { DEFAULT_PROFILE_SOURCE } from "./default-profile.ts";
export {
  DEFAULT_PARTIAL_CONTEXT,
  isPartialContext,
  PARTIAL_CONTEXTS,
} from "@zotlit/notes/core/template-preview/partial-preview.ts";
export type {
  PartialChoice,
  PartialContext,
  PartialPreviewSelection,
} from "@zotlit/notes/core/template-preview/partial-preview.ts";
export {
  captureRenderReport,
  engineEvidence,
  formatRenderReport,
} from "@zotlit/notes/core/template/render-report.ts";
export type { WorkbenchReportContext } from "@zotlit/notes/core/template/render-report.ts";
export {
  emptyRender,
  failedRender,
  renderFailed,
  retainOutputs,
  templateSourceRevision,
  renderIdentity,
} from "./result.ts";
export type {
  TemplateRenderResult,
  PreviewHint,
  RenderDiagnostic,
  RenderedProperty,
  RenderedRange,
} from "./result.ts";
export { renderFailureDiagnosticWithCallSite } from "./call-attribution.ts";
export { currentSliceSite } from "./locate.ts";
export type { RenderCallerSource } from "@zotlit/notes/core/template/render-failure.ts";
export type { RenderRequest, RenderOptions } from "./request.ts";
export { restoreTemplateData } from "@zotlit/notes/core/template-preview/restore-template-data.ts";
export { SAMPLE_ANNOTATIONS } from "@zotlit/notes/core/template-preview/sample-annotations.ts";
export type { AnnotationExample } from "@zotlit/notes/core/template-preview/sample-annotations.ts";

export const SAMPLE_ITEMS = [
  journalArticle,
  conferencePaper,
  book,
  thesis,
] as unknown as readonly ItemSnapshot[];

export function renderProfile(
  source: string,
  snapshot: ItemSnapshot,
  options: RenderOptions = {},
): TemplateRenderResult {
  const { annotation: example } = options;
  const identity = renderIdentity({ source, snapshot, ...options });
  if (snapshot.contractVersion !== CONTRACT_VERSION) {
    return failedRender(identity, {
      code: "contract-version-mismatch",
      params: { found: snapshot.contractVersion, expected: CONTRACT_VERSION },
    });
  }

  const facade = new TemplateFacade();
  let document;
  try {
    document = facade.parseLiteratureNoteTemplate(source);
  } catch (error) {
    return failedRender(identity, {
      code: "invalid-profile",
      message: errorMessage(error),
      evidence: engineEvidence(error),
      part: "profile",
    });
  }
  const defined = new Set(
    (document.manifest.partials ?? []).map(({ name }) => name),
  );
  const caller: RenderCallerSource = {
    source,
    profileId: document.manifest.id,
    language: document.manifest.language ?? "liquid",
  };
  let preview: string | null = null;
  let annotationCitation: string | null = null;
  let formatFailure: RenderDiagnostic | null = null;
  let filename: string | null = null;
  let filenameFailure: RenderDiagnostic | null = null;

  try {
    for (const partial of document.manifest.partials ?? []) {
      facade.define(partial.name, partial.source, partial.language);
    }
    const note = restoreTemplateData(
      snapshot.roots.note,
      snapshot.descriptors.note,
    );
    const filenameData = restoreTemplateData(
      snapshot.roots.filename,
      snapshot.descriptors.filename,
    );
    try {
      filename = replaceSuffixMarkers(
        facade.renderLiteratureNoteTemplateFilename(document, filenameData),
        () => "",
      );
    } catch (error) {
      filenameFailure = filenameErrorDiagnostic(error, caller);
    }
    const annotations = snapshot.roots.annotations.map((annotation, index) => {
      const descriptors = snapshot.descriptors.annotations[index];
      if (!descriptors) {
        throw new Error(`Annotation ${index} has no snapshot descriptors.`);
      }
      return withRenderedCitation(
        facade,
        restoreTemplateData(annotation, descriptors),
        defined.has(CITATION_TEMPLATE),
      );
    });
    try {
      const selected = example
        ? withRenderedCitation(
            facade,
            restoreTemplateData(example.root, example.descriptors),
            defined.has(CITATION_TEMPLATE),
          )
        : annotations[0];
      if (selected) {
        preview = facade.renderLiteratureNoteTemplateAnnotation(
          document,
          selected,
        );
        annotationCitation = selected.citation;
      }
    } catch (error) {
      preview = null;
      formatFailure = {
        ...withCallIdentity(
          renderFailureDiagnosticWithCallSite(error, caller),
          caller,
        ),
        evidence: engineEvidence(error),
        part: "annotation",
      };
    }
    const createdBody = facade.renderLiteratureNoteTemplateForCreate(
      document,
      note,
    );
    const frontmatter = evaluateFrontmatter(
      facade,
      document.manifest.frontmatter ?? [],
      note,
    );
    const managedRegion = facade.renderLiteratureNoteTemplateForUpdate(
      document,
      note,
    );
    const creationBody =
      options.mode === "update" && managedRegion !== null
        ? replaceManagedRegion(createdBody, () => managedRegion).content
        : createdBody;
    return {
      ...identity,
      filename,
      notePath: resolveNoteRelPath(filename),
      properties: frontmatter.properties,
      fold: frontmatter.fold,
      frontmatterBlock: frontmatterBlock(frontmatter.fold),
      creationBody,
      managedRegion,
      citation: null,
      partial: null,
      annotation: preview,
      annotationCitation,
      annotationRanges: locateOutputs(
        creationBody,
        annotations.flatMap((annotation) => {
          try {
            return [
              facade.renderLiteratureNoteTemplateAnnotation(
                document,
                annotation,
              ),
            ];
          } catch {
            return [];
          }
        }),
      ),
      diagnostics: [
        ...(filenameFailure ? [filenameFailure] : []),
        ...(formatFailure ? [formatFailure] : []),
        ...frontmatter.diagnostics,
      ],
    };
  } catch (error) {
    const failure = failedRender(identity, {
      ...withCallIdentity(
        renderFailureDiagnosticWithCallSite(error, caller),
        caller,
      ),
      evidence: engineEvidence(error),
      part: isAnnotationError(error) ? "annotation" : "render",
    });
    return {
      ...failure,
      filename,
      notePath: resolveNoteRelPath(filename),
      annotation: preview,
      annotationCitation,
      diagnostics: [
        ...(filenameFailure ? [filenameFailure] : []),
        ...(formatFailure ? [formatFailure] : []),
        ...failure.diagnostics,
      ],
    };
  }
}

export function filenameErrorDiagnostic(
  error: unknown,
  caller: RenderCallerSource,
): RenderDiagnostic {
  const {
    sourceSite: _read,
    callSite: _called,
    ...attributed
  } = renderFailureDiagnosticWithCallSite(error, caller);
  const site = renderFailureSpan(error);
  return {
    ...attributed,
    ...(site === undefined ? {} : { sliceSite: site }),
    evidence: engineEvidence(error),
    part: "filename",
  };
}

function withCallIdentity(
  diagnostic: Omit<RenderDiagnostic, "part">,
  caller: RenderCallerSource,
): Omit<RenderDiagnostic, "part"> {
  const site = diagnostic.callSite;
  return site === undefined
    ? diagnostic
    : {
        ...diagnostic,
        callIdentity: caller.source.slice(site.from, site.to),
      };
}

const CITATION_TEMPLATE = "citation";

function withRenderedCitation(
  facade: TemplateFacade,
  restored: Record<string, unknown>,
  hasCitationTemplate: boolean,
): AnnotationTemplateContext {
  const annotation = restored as unknown as TemplateAnnotation;
  return withAnnotationCitation(annotation, () => {
    const parent = annotation.parentItem;
    if (!hasCitationTemplate || !parent?.citekey) return null;
    return inlineCitation(
      facade.render(
        CITATION_TEMPLATE,
        citekeysToCiteTemplateData(
          [
            {
              citationKey: parent.citekey,
              item: narrowBaseDataToCiteItemData(parent, parent.citekey),
              label: "page",
              locator: annotation.pageLabel,
            },
          ],
          "main",
        ),
      ),
    );
  });
}

function evaluateFrontmatter(
  facade: TemplateFacade,
  authored: readonly ManagedFrontmatterEntry[],
  note: object,
): {
  properties: readonly RenderedProperty[];
  fold: readonly RenderedProperty[];
  diagnostics: readonly RenderDiagnostic[];
} {
  const { compiled } = facade.compileManagedFrontmatterEntries(authored, {
    javascript: false,
  });
  const { values, errors } = evalManagedFrontmatterEntries(
    compiled,
    note,
    Temporal.Now.instant(),
  );
  const properties = values.map(rendered);
  const conflicts: EntryDiagnostic[] = [];
  const patch = mergeManagedFrontmatterEntries(values, {
    onConflict: (key, { position, recovery }) =>
      conflicts.push({
        code: "property-append-conflict",
        params: { key },
        ...(recovery === undefined ? {} : { message: recovery }),
        part: "properties",
        position: position!,
      }),
  });
  const fold = Object.entries(patch).map(([key, value]) => ({
    key,
    ...(value === FRONTMATTER_ABSENT ? {} : { value }),
    missing: value === FRONTMATTER_ABSENT,
    position: properties.find(
      (property) => property.key === key && !property.missing,
    )!.position,
  }));
  const diagnostics = [
    ...authored.flatMap((entry, index) =>
      "js" in entry
        ? [
            {
              code: "property-javascript" as const,
              ...(entry.key === undefined
                ? {}
                : { params: { key: entry.key } }),
              part: "properties" as const,
              position: index + 1,
            },
          ]
        : [],
    ),
    ...errors.map((error) =>
      propertyErrorDiagnostic(error, authored[error.position - 1]),
    ),
    ...conflicts,
  ].toSorted(byPosition);
  return { properties, fold, diagnostics };
}

function frontmatterBlock(fold: readonly RenderedProperty[]): string | null {
  const present = fold.filter(({ missing }) => !missing);
  if (present.length === 0) return null;
  return stringifyYaml(
    Object.fromEntries(present.map(({ key, value }) => [key, value])),
    { lineWidth: 0 },
  );
}

type EntryDiagnostic = RenderDiagnostic & { readonly position: number };

function byPosition(a: EntryDiagnostic, b: EntryDiagnostic): number {
  return a.position - b.position;
}

function rendered({
  key,
  value,
  position,
}: EvaluatedFrontmatterField): RenderedProperty {
  const missing = value === undefined || value === FRONTMATTER_ABSENT;
  return { key, ...(missing ? {} : { value }), missing, position: position! };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function propertyErrorDiagnostic(
  { key, position, error }: ManagedFrontmatterEvaluationError,
  authored: ManagedFrontmatterEntry | undefined,
): RenderDiagnostic & { readonly position: number } {
  const site = entrySite(error, authored);
  return {
    code: "property-error",
    message: errorMessage(error),
    evidence: engineEvidence(error),
    params: { key, detail: engineClause(error) },
    part: "properties",
    position,
    ...(site === undefined ? {} : { sliceSite: site }),
  };
}

function engineClause(error: unknown): string {
  return errorMessage(errorChain(error).at(-1) ?? error);
}

function entrySite(
  error: unknown,
  authored: ManagedFrontmatterEntry | undefined,
): SliceSite | undefined {
  const chain = errorChain(error);
  const path = chain.find(
    (link): link is FrontmatterJsonEError =>
      link instanceof FrontmatterJsonEError && link.path !== undefined,
  )?.path;
  if (path !== undefined && authored !== undefined && "value" in authored) {
    const source = authoredAt(authored.value, path);
    if (source !== undefined) return { kind: "path", path, source };
  }
  return renderFailureSpan(error);
}

function authoredAt(
  value: unknown,
  path: readonly (string | number)[],
): string | undefined {
  let node = value;
  for (const segment of path) {
    if (node === null || typeof node !== "object") return undefined;
    if (!Array.isArray(node) && Object.keys(node).some(isOperatorKey))
      return undefined;
    node = (node as Record<string | number, unknown>)[segment];
    if (node === undefined) return undefined;
  }
  return JSON.stringify(node);
}

function isOperatorKey(key: string): boolean {
  return key.startsWith("$") && !key.startsWith("$$");
}

function isAnnotationError(error: unknown): boolean {
  if (!(error instanceof Error) || !("token" in error)) return false;
  const { token } = error;
  return (
    typeof token === "object" &&
    token !== null &&
    "file" in token &&
    token.file === "annotation"
  );
}

function locateOutputs(
  body: string,
  outputs: readonly string[],
): RenderedRange[] {
  const ranges: RenderedRange[] = [];
  let cursor = 0;
  for (const output of outputs) {
    if (output.length === 0) continue;
    const from = body.indexOf(output, cursor);
    if (from === -1) continue;
    cursor = from + output.length;
    ranges.push({ from, to: cursor });
  }
  return ranges;
}
