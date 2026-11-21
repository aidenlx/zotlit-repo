// Browser-safe rendering of Workbench Item Snapshots. CSL formatting stays in
// Obsidian because this preview produces the Profile's generated Markdown and
// has no bibliography or citation processor.

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
// oxlint-disable-next-line no-restricted-imports -- this entry of the templates is host-free; the host pattern matches its name.
import { replaceManagedRegion } from "@zotlit/templates/obsidian";
import type { ItemSnapshot } from "@zotlit/zotero-reads/contract/snapshot/types.ts";

import { renderFailureDiagnostic } from "./call-attribution.ts";
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
export { renderFailureDiagnostic } from "./call-attribution.ts";
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
  // The draft this render reads, which a repair location is an offset into:
  // both hosts name the partial the engine could not resolve and the call to
  // repair it at, rather than leaving the web with the engine's bare words.
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
    // The note name is rendered on its own first, so a mistake in the Filename
    // Template is named as the note name's and leaves every other output on
    // screen. A mistake anywhere else leaves the name this attempt produced.
    try {
      // A preview assumes a free filename; the vault resolves collisions on save.
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
    // The format is rendered on its own, ahead of the note, so a failure inside
    // it is named as the format's and a host can show it where it is edited. The
    // note goes on rendering: one that never calls the format keeps its
    // preview, and one that does retains its own occurrence of the fault.
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
        ...withCallIdentity(renderFailureDiagnostic(error, caller), caller),
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
      // The web host renders a Profile only; a Citation Template and a Shared
      // Partial are previewed in Obsidian, where both documents live.
      citation: null,
      partial: null,
      annotation: preview,
      annotationCitation,
      annotationRanges: locateOutputs(
        creationBody,
        annotations.flatMap((annotation) => {
          // Marks belong only to successful outputs of the note's own annotations.
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
      ...withCallIdentity(renderFailureDiagnostic(error, caller), caller),
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

/**
 * What one failed note-name render reads as, wherever it ran. The place is
 * named inside the note-name template's own text rather than in the document
 * that holds it: the pane the reader edits shows exactly that text, so the
 * mark lands there without reading whatever quoting the manifest wrote the
 * value under. Both hosts render the note name apart from the note, so both
 * name the fault the same way; this is where that answer is written, once.
 */
export function filenameErrorDiagnostic(
  error: unknown,
  caller: RenderCallerSource,
): RenderDiagnostic {
  // Every place read off the whole document is dropped: a scan of the source
  // can spell the blamed template in the note as well, and one fault marks one
  // place. What is left names the note name and nowhere else.
  const {
    sourceSite: _read,
    callSite: _called,
    ...attributed
  } = renderFailureDiagnostic(error, caller);
  const site = renderFailureSpan(error);
  return {
    ...attributed,
    ...(site === undefined ? {} : { sliceSite: site }),
    evidence: engineEvidence(error),
    part: "filename",
  };
}

/** Preserve which verified call failed without making its source offset an ID. */
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

/** The Citation Template name an annotation's page-pinned citation renders through. */
const CITATION_TEMPLATE = "citation";

/**
 * The annotation's `citation`, produced here rather than carried in the
 * snapshot: Obsidian renders it from the parent Item with the annotation's
 * page as locator through the Citation Template under the main Citation
 * Variant, so a preview holding that template produces the same text. A bundle
 * carrying no Citation Template, and a parent Item with no citation key, leave
 * the value null.
 * @see apps/obsidian/src/services/template/annotation-render.ts annotationCitation
 */
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

/**
 * Evaluates every authored entry against one snapshot — each on its own, none
 * reading another's result — so a row shows what it produced by itself, then
 * folds every contribution in list order into the frontmatter the note gets.
 * Every diagnostic carries the 1-based position of the entry that raised it,
 * which is how a row claims its own.
 */
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
    // An append that meets a value it cannot extend leaves the fold without the
    // key it produced, so the entry that produced it says so. Every compiled
    // entry stamps its own position onto what it produced, so the conflict
    // names one.
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
    // Every merged key came from one of these values, and the first entry to
    // produce one fixes where it sits in a created note. An entry whose
    // expression produced nothing contributed no such value.
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

/**
 * The fold as the note's own YAML block. An absent key contributes nothing to
 * the created note, so it is left out here too.
 */
function frontmatterBlock(fold: readonly RenderedProperty[]): string | null {
  const present = fold.filter(({ missing }) => !missing);
  if (present.length === 0) return null;
  return stringifyYaml(
    Object.fromEntries(present.map(({ key, value }) => [key, value])),
    { lineWidth: 0 },
  );
}

/** A property diagnostic, which always names the entry that raised it. */
type EntryDiagnostic = RenderDiagnostic & { readonly position: number };

/** List order, so the diagnostic a host reads first belongs to the first row. */
function byPosition(a: EntryDiagnostic, b: EntryDiagnostic): number {
  return a.position - b.position;
}

function rendered({
  key,
  value,
  position,
}: EvaluatedFrontmatterField): RenderedProperty {
  const missing = value === undefined || value === FRONTMATTER_ABSENT;
  // Every compiled entry stamps its own position onto what it produced.
  return { key, ...(missing ? {} : { value }), missing, position: position! };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What one failed Managed Frontmatter entry reads as, wherever it ran. Both
 * hosts evaluate the same entries through the same engines, so both name the
 * fault the same way and place it in the same row; this is where that answer
 * is written, once.
 */
export function propertyErrorDiagnostic(
  { key, position, error }: ManagedFrontmatterEvaluationError,
  authored: ManagedFrontmatterEntry | undefined,
): RenderDiagnostic & { readonly position: number } {
  const site = entrySite(error, authored);
  return {
    code: "property-error",
    message: errorMessage(error),
    evidence: engineEvidence(error),
    // The engine's own last word, which the row reads on its own: the wrapper
    // around it names the entry the row already names.
    params: { key, detail: engineClause(error) },
    part: "properties",
    position,
    ...(site === undefined ? {} : { sliceSite: site }),
  };
}

/**
 * What the engine itself said, taken from the innermost link of the chain.
 * Everything wrapped around it repeats the entry the row already names, so a
 * row that carries this reads one sentence about one fault.
 */
function engineClause(error: unknown): string {
  return errorMessage(errorChain(error).at(-1) ?? error);
}

/**
 * Where one entry failure points inside the entry's own expression, with what
 * the attempt read there. JSON-e names the keys and indexes it walked; Liquid
 * names the span of expression text it tokenized. Either way the text travels
 * with the place, so a host marks it only against an expression that still
 * spells the same thing.
 */
function entrySite(
  error: unknown,
  authored: ManagedFrontmatterEntry | undefined,
): SliceSite | undefined {
  const chain = errorChain(error);
  // An empty path is the whole authored value, which is the place a rule of
  // one operator fails at: JSON-e names the node it walked to, and for such a
  // rule that node is the expression itself.
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

/**
 * What the author wrote at `path`, as the value a later mark is checked
 * against. Undefined where the path does not describe the authored value at
 * all: JSON-e leaves its own operator keys out of the locations it reports, so
 * a path that steps through an operator names a place the author never wrote
 * there, and a sibling that happens to sit at that name is not the fault.
 */
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

/** A key JSON-e reads as an operator rather than as a name to produce. */
function isOperatorKey(key: string): boolean {
  return key.startsWith("$") && !key.startsWith("$$");
}

/** Liquid retains the source token when a note call fails inside the format. */
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

/**
 * Where each output landed in the body, searched forward in order so two
 * highlights with the same text take two places. An output the body does not
 * carry — a note that calls the format for some highlights only — is skipped,
 * and an empty output marks nothing.
 */
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
