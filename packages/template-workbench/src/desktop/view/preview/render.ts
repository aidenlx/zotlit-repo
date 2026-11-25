import type {
  PartialContext,
  PartialPreviewSelection,
  RenderCallerSource,
  TemplateRenderResult,
  RenderRequest,
  RenderDiagnostic,
} from "#core/render/index.ts";
import { Cause, DateTime, Effect, Exit } from "effect";
import { stringifyYaml } from "obsidian";
import type { App } from "obsidian";

import { BibliographyRender } from "@zotlit/citations/obsidian/pandoc/render-cache.ts";
import { DEFAULT_CITATION_VARIANT, withAnnotationCitation } from "@zotlit/db";
import type {
  AnnotationTemplateContext,
  CitationTemplateData,
  NoteTemplateContext,
} from "@zotlit/db";
import type { ContractRoot } from "@zotlit/db";
import { plainTemplateError } from "@zotlit/notes/core/template/errors.ts";
import {
  applyComposedFrontmatter,
  composeLiteratureNote,
  prepareLiteratureNote,
} from "@zotlit/notes/desktop/note-feature/index.ts";
import { annotationCitation as renderAnnotationCitation } from "@zotlit/notes/desktop/template/annotation-render.ts";
import {
  readTemplateData,
  readCitationData,
  withSettings,
} from "@zotlit/notes/desktop/template/data.ts";
import { bindProfile } from "@zotlit/notes/obsidian/profile/bindings.ts";
import { bindUnvalidatedDraftProfile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import type { TemplateOperations } from "@zotlit/notes/obsidian/template/service.ts";
import {
  syncTemplate,
  profileCall,
} from "@zotlit/notes/obsidian/template/sync-template.ts";
import { readLiveText } from "@zotlit/obsidian-kit/effect-live-text.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { DEFAULT_PROFILE } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { ProfileId } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type {
  ViewRegistryHandle,
  ViewServices,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import { FIELD_DOCUMENT_LANGUAGE } from "@zotlit/plugin-kernel/constants.ts";
import { isLanguageTag } from "@zotlit/plugin-kernel/language-tag.ts";
import { toInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { replaceSuffixMarkers, resolveNoteRelPath } from "@zotlit/templates";
import type { LiteratureNoteTemplateManifest } from "@zotlit/templates/facade";
import { parsePlainTemplateDocument } from "@zotlit/templates/facade";
import type { FrontmatterMergeConflictHandler } from "@zotlit/templates/frontmatter-merge";

import { restoreTemplateData } from "#core/render/index.ts";
import {
  citationExampleData,
  emptyRender,
  engineEvidence,
  failedRender,
  filenameErrorDiagnostic,
  propertyErrorDiagnostic,
  renderFailureDiagnosticWithCallSite,
  renderIdentity,
  retainOutputs,
  sampleItemCitation,
  SAMPLE_ANNOTATIONS,
} from "#core/render/index.ts";
import { previewBaseline } from "#obsidian/cli/preview-baseline.ts";
export { previewBaseline } from "#obsidian/cli/preview-baseline.ts";
import type { PreviewCitation } from "#obsidian/view/preview/citations.ts";

import { previewPropertyRows } from "#obsidian/cli/check-profile.ts";
import { renderDraftCitations } from "#obsidian/view/preview/citations.ts";

export interface PreviewRenderDeps {
  readonly app: App;
  readonly registry: ViewRegistryHandle;
  readonly openCitationEngineSettings: () => void;
}

interface RenderEnvironment {
  app: App;
  settings: Readonly<Settings>;
  templates: Pick<
    TemplateOperations,
    | "render"
    | "renderCitation"
    | "renderCitationSource"
    | "renderPartialSource"
    | "prepareLiteratureNoteTemplateSource"
    | "frontmatterFields"
    | "javascriptTemplatesEnabled"
  >;
  dataSettings?: Readonly<Settings>;
}

const renderEnvironment = Effect.gen(function* () {
  const template = yield* Template;
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  const read = <A, E>(effect: Effect.Effect<A, E>): A => {
    const exit = run(Effect.exit(effect));
    if (Exit.isFailure(exit))
      throw plainTemplateError(Cause.squash(exit.cause));
    return exit.value;
  };
  const templates: RenderEnvironment["templates"] = {
    ...(yield* syncTemplate),
    renderCitationSource: (source, data) =>
      read(template.renderCitationSource(source, data)),
    renderPartialSource: (source, data, options) =>
      read(template.renderPartialSource(source, data, options)),
    prepareLiteratureNoteTemplateSource: (source) =>
      read(template.prepareLiteratureNoteTemplateSource(source)),
    javascriptTemplatesEnabled: yield* template.javascriptTemplatesEnabled,
  };
  return { settings: yield* (yield* PluginSettings).current, templates };
});

const loadTemplateData = (
  deps: RenderEnvironment,
  key: string,
  root: ContractRoot,
) =>
  deps.dataSettings
    ? readTemplateData(key, root).pipe(withSettings(deps.dataSettings))
    : readTemplateData(key, root);

export interface PreviewRenderResult extends TemplateRenderResult {
  readonly sourcePath: string;
  readonly annotationSourcePath?: string;
  readonly citations: readonly PreviewCitation[];
  readonly annotationCitations: readonly PreviewCitation[];
}

export function retainPreviewOutputs(
  kept: PreviewRenderResult,
  result: PreviewRenderResult,
): PreviewRenderResult {
  const retained = retainOutputs(kept, result);
  if (retained === result) return result;
  const note =
    result.creationBody === null && kept.creationBody !== null ? kept : result;
  const annotation =
    result.annotation === null && kept.annotation !== null ? kept : result;
  return {
    ...retained,
    sourcePath: note.sourcePath,
    citations: note.citations,
    annotationSourcePath:
      annotation.annotationSourcePath ?? annotation.sourcePath,
    annotationCitations: annotation.annotationCitations,
  };
}

export function previewResult(
  result: TemplateRenderResult,
): PreviewRenderResult {
  return { sourcePath: "", citations: [], annotationCitations: [], ...result };
}

const renderPreviewTemplateEffect = Effect.fn("NotePreview.render")(function* (
  deps: PreviewRenderDeps,
  request: RenderRequest,
) {
  const environment: RenderEnvironment = {
    app: deps.app,
    ...(yield* renderEnvironment),
  };
  if (request.partial)
    return yield* renderPreviewPartial(environment, request, request.partial);
  return yield* request.citation
    ? renderPreviewCitation(environment, request)
    : renderPreviewProfileEffect(environment, request);
});

export function makePreviewRenderer(deps: PreviewRenderDeps) {
  return {
    render: (
      request: RenderRequest,
    ): Effect.Effect<PreviewRenderResult, unknown, ViewServices> =>
      renderPreviewTemplateEffect(deps, request),
    partial: (
      request: RenderRequest,
      partial: PartialPreviewSelection,
    ): Effect.Effect<string, unknown, ViewServices> =>
      Effect.gen(function* () {
        const environment: RenderEnvironment = {
          app: deps.app,
          ...(yield* renderEnvironment),
        };
        return yield* renderRegisteredPartialEffect(
          environment,
          request,
          partial,
        );
      }),
  };
}

const renderPreviewPartial = Effect.fn("NotePreview.renderPreviewPartial")(
  function* (
    deps: RenderEnvironment,
    request: RenderRequest,
    selection: PartialPreviewSelection,
  ): Effect.fn.Return<PreviewRenderResult, unknown, ViewServices> {
    const identity = renderIdentity(request);
    return yield* Effect.gen(function* (): Effect.fn.Return<
      PreviewRenderResult,
      unknown,
      ViewServices
    > {
      const data = yield* partialRootData(deps, request, selection);
      if (data.kind !== "data") {
        return previewResult(
          failedRender(identity, {
            code: "render-error",
            message: data.message,
            part: "render",
          }),
        );
      }
      return {
        ...previewResult(emptyRender(identity)),
        partial: deps.templates.renderPartialSource(request.source, data.data, {
          name: selection.name,
        }),
      };
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const error = Cause.squash(cause);
          return previewResult(
            failedRender(
              identity,
              renderFault(error, "render", callerSource(deps, request.source)),
            ),
          );
        }),
      ),
    );
  },
);

const renderRegisteredPartialEffect = Effect.fn(
  "NotePreview.renderRegisteredPartial",
)(function* (
  deps: RenderEnvironment,
  request: RenderRequest,
  selection: PartialPreviewSelection,
): Effect.fn.Return<string, unknown, ViewServices> {
  const data = yield* partialRootData(deps, request, selection);
  if (data.kind !== "data") throw new Error(data.message);
  return deps.templates.render(selection.name, data.data);
});

const partialRootData = Effect.fn("NotePreview.partialRootData")(function* (
  deps: RenderEnvironment,
  request: RenderRequest,
  selection: PartialPreviewSelection,
): Effect.fn.Return<
  { kind: "data"; data: object } | { kind: "unavailable"; message: string },
  unknown,
  ViewServices
> {
  const settings = deps.settings;
  const chosen =
    selection.profile === null
      ? undefined
      : yield* profileCall(
          (yield* Profile).resolveProfile(selection.profile as ProfileId),
        );
  const draft = chosen ? null : draftProfileManifest(deps, request.source);
  const profile =
    chosen ??
    (draft
      ? bindUnvalidatedDraftProfile(settings, draft)
      : bindProfile(settings, { selector: DEFAULT_PROFILE }));
  return yield* partialContextData(
    { ...deps, dataSettings: profile.settings },
    request,
    selection.context,
  );
});

function draftProfileManifest(
  deps: RenderEnvironment,
  source: string,
): LiteratureNoteTemplateManifest | null {
  try {
    const { manifest } =
      deps.templates.prepareLiteratureNoteTemplateSource(source);
    return manifest.id ? manifest : null;
  } catch {
    return null;
  }
}

const partialContextData = Effect.fn("NotePreview.partialContextData")(
  function* (
    deps: RenderEnvironment,
    request: RenderRequest,
    context: PartialContext,
  ): Effect.fn.Return<
    { kind: "data"; data: object } | { kind: "unavailable"; message: string },
    unknown,
    ViewServices
  > {
    const sample = request.snapshot.provenance.kind === "sample";
    if (context === "citation") return yield* citationRootData(deps, request);
    if (context === "annotation") {
      const example = request.annotation;
      if (!example) {
        return {
          kind: "unavailable",
          message: m.workbench_preview_choose_annotation(),
        };
      }
      const key = example.root.indexedKey;
      const live =
        typeof key === "string" &&
        !sample &&
        !SAMPLE_ANNOTATIONS.some(({ id }) => id === example.id)
          ? yield* loadTemplateData(deps, key, "annotation")
          : null;
      if (live?.kind === "data") return { kind: "data", data: live.data };
      const restored = restoreTemplateData(
        example.root,
        example.descriptors,
      ) as unknown as AnnotationTemplateContext;
      return {
        kind: "data",
        data: withAnnotationCitation(restored, () =>
          renderAnnotationCitation(
            restored.parentItem,
            restored.pageLabel,
            deps.templates,
          ),
        ),
      };
    }
    if (sample) {
      return {
        kind: "data",
        data: restoreTemplateData(
          request.snapshot.roots.note,
          request.snapshot.descriptors.note,
        ),
      };
    }
    const note = yield* loadTemplateData(
      deps,
      request.snapshot.item.indexedKey,
      "note",
    );
    return note.kind === "data"
      ? { kind: "data", data: note.data }
      : { kind: "unavailable", message: m.workbench_example_missing_item() };
  },
);

const renderPreviewCitation = Effect.fn("NotePreview.renderPreviewCitation")(
  function* (
    deps: RenderEnvironment,
    request: RenderRequest,
  ): Effect.fn.Return<PreviewRenderResult, unknown, ViewServices> {
    const identity = renderIdentity(request);
    return yield* Effect.gen(function* (): Effect.fn.Return<
      PreviewRenderResult,
      unknown,
      ViewServices
    > {
      const data = yield* citationRootData(deps, request);
      if (data.kind !== "data") throw new Error(data.message);
      return {
        ...previewResult(emptyRender(identity)),
        citation: deps.templates.renderCitationSource(
          request.source,
          data.data,
        ),
      };
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const error = Cause.squash(cause);
          return previewResult(
            failedRender(
              identity,
              renderFault(error, "render", callerSource(deps, request.source)),
            ),
          );
        }),
      ),
    );
  },
);

const citationRootData = Effect.fn("NotePreview.citationRootData")(function* (
  deps: RenderEnvironment,
  request: RenderRequest,
): Effect.fn.Return<
  | { kind: "data"; data: CitationTemplateData }
  | { kind: "unavailable"; message: string },
  unknown,
  ViewServices
> {
  const selection = request.citation;
  const variant = selection?.variant ?? DEFAULT_CITATION_VARIANT;
  if (selection?.example)
    return {
      kind: "data",
      data: citationExampleData(selection.example, variant),
    };
  if (request.snapshot.provenance.kind === "sample")
    return {
      kind: "data",
      data: sampleItemCitation(request.snapshot, variant),
    };
  const loaded = yield* readCitationData(
    { key: request.snapshot.item.indexedKey },
    variant,
  );
  return loaded.kind === "data"
    ? { kind: "data", data: loaded.data }
    : { kind: "unavailable", message: m.workbench_example_missing_item() };
});

const renderPreviewProfileEffect = Effect.fn(
  "NotePreview.renderPreviewProfile",
)(function* (
  deps: RenderEnvironment,
  request: RenderRequest,
): Effect.fn.Return<PreviewRenderResult, unknown, ViewServices> {
  const identity = renderIdentity(request);
  let sourcePath = "";
  let noteName: string | null = null;
  let noteNameFailure: RenderDiagnostic | null = null;
  return yield* Effect.gen(function* (): Effect.fn.Return<
    PreviewRenderResult,
    unknown,
    ViewServices
  > {
    const document = deps.templates.prepareLiteratureNoteTemplateSource(
      request.source,
    );
    const settings = deps.settings;
    const manifest = document.manifest;
    const profile = bindUnvalidatedDraftProfile(settings, manifest);
    const dataDeps = { ...deps, dataSettings: profile.settings };
    const indexedKey = request.snapshot.item.indexedKey;
    const sample = request.snapshot.provenance.kind === "sample";
    const loadRoot = (root: "note" | "filename") =>
      sample
        ? Effect.succeed({
            kind: "data" as const,
            data: restoreTemplateData(
              request.snapshot.roots[root],
              request.snapshot.descriptors[root],
            ),
          })
        : loadTemplateData(dataDeps, indexedKey, root);
    const [note, filename] = yield* Effect.all(
      [loadRoot("note"), loadRoot("filename")],
      { concurrency: "unbounded" },
    );
    if (note.kind !== "data" || filename.kind !== "data")
      throw new Error("The selected Zotero item is unavailable.");
    const context = note.data as NoteTemplateContext;
    const composeDeps = { template: deps.templates };
    const diagnostics: RenderDiagnostic[] = [];
    const filenameResult = yield* Effect.exit(
      Effect.sync(() =>
        replaceSuffixMarkers(document.renderFilename(filename.data), () => ""),
      ),
    );
    if (Exit.isSuccess(filenameResult)) noteName = filenameResult.value;
    else {
      noteNameFailure = filenameErrorDiagnostic(
        Cause.squash(filenameResult.cause),
        callerSource(deps, request.source),
      );
      diagnostics.push(noteNameFailure);
    }
    const onConflict: FrontmatterMergeConflictHandler = (key, detail) =>
      diagnostics.push({
        code: "property-append-conflict",
        part: "properties",
        position: detail.position,
        params: { key },
      });
    const now = toInstant(yield* DateTime.now);
    const composed =
      request.mode === "update"
        ? prepareLiteratureNote(composeDeps, { context, document, now })
        : composeLiteratureNote(composeDeps, {
            context,
            itemKey: indexedKey,
            profile,
            document,
            onConflict,
            now,
          });
    const { prepared } = composed;
    const properties: TemplateRenderResult["properties"][number][] = [];
    if (prepared.kind === "document")
      properties.push(...previewPropertyRows(prepared.fields));
    if (composed.outcome === "refused")
      for (const error of composed.evaluation.errors)
        diagnostics.push(
          propertyErrorDiagnostic(
            error,
            manifest.frontmatter?.[error.position - 1],
          ),
        );
    manifest.frontmatter?.forEach((entry, index) => {
      if ("js" in entry && !deps.templates.javascriptTemplatesEnabled)
        diagnostics.push({
          code: "render-error",
          message: m.profile_preview_javascript_disabled(),
          part: "properties",
          position: index + 1,
        });
    });
    const created =
      composed.outcome === "refused"
        ? document.renderForCreate(context)
        : composed.body;
    const managed = document.renderForUpdate(context);
    const existing = sample
      ? null
      : ((yield* (yield* NoteIndex).getNotesByItemKey(indexedKey))[0] ?? null);
    sourcePath = existing?.path ?? "";
    const file = sourcePath
      ? yield* (yield* Vault).getFileByPath(sourcePath)
      : null;
    const original =
      request.mode === "update" && file ? yield* readLiveText(file) : null;
    let frontmatter: Record<string, unknown>;
    let body: string;
    let frontmatterBlock: string;
    if (composed.outcome === "composed") {
      ({ frontmatter, body, frontmatterBlock } = composed);
    } else {
      ({ frontmatter, body } = previewBaseline(
        original,
        created,
        request.mode === "update" ? managed : null,
      ));
      applyComposedFrontmatter(composeDeps, frontmatter, {
        context,
        itemKey: indexedKey,
        profile,
        prepared,
        onConflict,
      });
      frontmatterBlock = stringifyYaml(frontmatter);
    }
    let annotation: string | null = null;
    let annotationCitation: string | null = null;
    const selectedAnnotation = request.annotation;
    if (selectedAnnotation) {
      yield* Effect.gen(function* () {
        const key = selectedAnnotation.root.indexedKey;
        const live =
          typeof key === "string" &&
          !sample &&
          !SAMPLE_ANNOTATIONS.some(({ id }) => id === selectedAnnotation.id)
            ? yield* loadTemplateData(dataDeps, key, "annotation")
            : null;
        const restored = restoreTemplateData(
          selectedAnnotation.root,
          selectedAnnotation.descriptors,
        ) as unknown as AnnotationTemplateContext;
        const root =
          live?.kind === "data"
            ? live.data
            : withAnnotationCitation(restored, () =>
                renderAnnotationCitation(
                  restored.parentItem,
                  restored.pageLabel,
                  deps.templates,
                ),
              );
        annotation = document.renderAnnotation(root);
        annotationCitation =
          "citation" in root && typeof root.citation === "string"
            ? root.citation
            : null;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            const error = Cause.squash(cause);
            diagnostics.push(
              renderFault(
                error,
                "annotation",
                callerSource(deps, request.source),
              ),
            );
          }),
        ),
      );
    }
    const annotationRanges: { from: number; to: number }[] = [];
    let cursor = 0;
    for (const root of context.annotations) {
      const rendered = yield* Effect.exit(
        Effect.sync(() => document.renderAnnotation(root)),
      );
      if (Exit.isFailure(rendered)) continue;
      const output = rendered.value;
      if (!output) continue;
      const from = body.indexOf(output, cursor);
      if (from >= 0) {
        cursor = from + output.length;
        annotationRanges.push({ from, to: cursor });
      }
    }
    const declaredLanguage = frontmatter[FIELD_DOCUMENT_LANGUAGE];
    const locale =
      typeof declaredLanguage === "string" ? declaredLanguage.trim() : "";
    const invalidLanguage =
      declaredLanguage !== undefined && !isLanguageTag(locale);
    if (invalidLanguage)
      diagnostics.push({
        code: "citation-style-error",
        part: "render",
        message: m.references_document_language_failed_title(),
      });
    const presentation = {
      sourcePath,
      locale:
        declaredLanguage === undefined
          ? (yield* (yield* BibliographyRender).state).vaultPresentation.locale
          : locale,
      styleId: profile.bindings["citation.references-style"],
      wikilinks: settings["citation.wikilink-citations"],
    };
    const noteCitations =
      invalidLanguage || sample
        ? { citations: [], diagnostics: [] }
        : yield* renderDraftCitations({
            ...presentation,
            markdown: body,
          });
    const annotationCitations =
      invalidLanguage ||
      sample ||
      SAMPLE_ANNOTATIONS.some(({ id }) => id === request.annotation?.id)
        ? { citations: [], diagnostics: [] }
        : yield* renderDraftCitations({
            ...presentation,
            markdown: annotation ?? "",
          });
    diagnostics.push(
      ...noteCitations.diagnostics,
      ...annotationCitations.diagnostics,
    );
    const previewHints = [
      ...(noteCitations.hint
        ? [{ ...noteCitations.hint, part: "note" as const }]
        : []),
      ...(annotationCitations.hint
        ? [{ ...annotationCitations.hint, part: "annotation" as const }]
        : []),
    ];
    return {
      ...identity,
      sourcePath,
      citations: noteCitations.citations,
      annotationCitations: annotationCitations.citations,
      filename: noteName,
      notePath: resolveNoteRelPath(noteName),
      properties,
      fold: Object.entries(frontmatter).map(([key, value]) => ({
        key,
        value,
        missing: false,
        position: properties.find((entry) => entry.key === key)?.position ?? 0,
      })),
      frontmatterBlock,
      creationBody: body,
      managedRegion: managed,
      annotation,
      annotationCitation,
      citation: null,
      partial: null,
      annotationRanges,
      diagnostics,
      previewHints,
    };
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        const error = Cause.squash(cause);
        const failure = failedRender(
          identity,
          renderFault(error, "render", callerSource(deps, request.source)),
        );
        return {
          ...failure,
          filename: noteName,
          notePath: resolveNoteRelPath(noteName),
          diagnostics: [
            ...(noteNameFailure ? [noteNameFailure] : []),
            ...failure.diagnostics,
          ],
          sourcePath,
          citations: [],
          annotationCitations: [],
        };
      }),
    ),
  );
});

function renderFault(
  error: unknown,
  part: RenderDiagnostic["part"],
  caller: RenderCallerSource,
): RenderDiagnostic {
  const evidence = engineEvidence(error);
  const diagnostic = renderFailureDiagnosticWithCallSite(error, caller);
  return {
    ...diagnostic,
    evidence,
    part: diagnostic.engine?.template === "annotation" ? "annotation" : part,
  };
}

function callerSource(
  deps: RenderEnvironment,
  source: string,
): RenderCallerSource {
  try {
    const { manifest } =
      deps.templates.prepareLiteratureNoteTemplateSource(source);
    return {
      source,
      language: manifest.language ?? "liquid",
      profileId: manifest.id,
    };
  } catch {
    // Plain templates declare their language independently of a Profile.
  }
  try {
    return {
      source,
      language:
        parsePlainTemplateDocument(source).manifest.language ?? "liquid",
    };
  } catch {
    return { source, language: "liquid" };
  }
}
