import type { CslStyleRequest } from "#core/pandoc/csl-style.ts";
import type { BibliographyItemRef } from "#desktop/pandoc/bibliography.ts";
import type { ExportPorts } from "#desktop/pandoc/export.ts";
import type { CitationEngine } from "#obsidian/pandoc/engine.ts";
import { Cause, Effect, FileSystem, Schema } from "effect";
import type { Context } from "effect";
import { basename, join } from "node:path";
import type { App, FileSystemAdapter, Plugin, TFile } from "obsidian";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { Library } from "@zotlit/db";
import { awaitModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import { withProgress } from "@zotlit/obsidian-kit/notifier.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { requestProfileSwitch } from "@zotlit/obsidian-kit/profile-recovery.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { packReaderId } from "@zotlit/plugin-services/obsidian/managed-binary/pack-row.ts";
import { resolveIndexedKey } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { PackBinaryRefusal } from "@zotlit/resource-pack/status.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import type { PandocExportChoices } from "./modal.ts";
import { openPandocExportModal } from "./modal.ts";
import { engineMissingMessage, exportFailureMessage } from "./notices.ts";
import type { ExportProblem } from "./notices.ts";

import { citationStyleLabel } from "#core/pandoc/citation-style.ts";
import {
  fetchBibliography,
  LOCAL_API_PREF,
} from "#desktop/pandoc/bibliography.ts";
import { describeError, exportCitedDocument } from "#desktop/pandoc/export.ts";
import { resolveInstalledStyle } from "#desktop/pandoc/styles.ts";
import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { CitationParse } from "#obsidian/citation-parse/service.ts";
import {
  documentPresentation,
  profileReaderOf,
  effectivePresentation,
  styleSourceOf,
  vaultPresentation,
} from "#obsidian/pandoc/document-presentation.ts";
import { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";
import { engineRefusal, PandocEngine } from "#obsidian/pandoc/service.ts";

export type PandocExportServices =
  | CitationLookup
  | CitationParse
  | FileSystem.FileSystem
  | Notifier
  | PandocEngine
  | PluginHost
  | PluginSettings
  | ProfileStyles
  | ZoteroHttp
  | ZoteroPref
  | ZoteroReads;

export interface PandocExportDeps {
  app: App;
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">;
  context: Context.Context<PandocExportServices>;
}

export function registerPandocExport(
  plugin: Pick<Plugin, "addCommand" | "app">,
  deps: PandocExportDeps,
): void {
  plugin.addCommand({
    id: "pandoc-export",
    name: m.command_pandoc_export_name(),
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file?.extension !== "md") return false;
      if (checking) return true;
      void runPandocExport(file, deps);
      return true;
    },
  });
}

class PandocExportError extends Schema.TaggedError<
  PandocExportError,
  { readonly brand: unique symbol }
>()("PandocExportError", {
  notice: Schema.declare<DocumentFragment>(
    (value): value is DocumentFragment => value instanceof DocumentFragment,
  ),
}) {}

export function runPandocExport(
  file: TFile,
  deps: PandocExportDeps,
): Promise<unknown> {
  return deps.bridge.runPromiseExit(
    prepareExport(file, deps).pipe(
      Effect.flatMap(({ run }) =>
        withProgress(
          run.pipe(
            Effect.flatMap((outcome) => {
              if (outcome.kind === "stopped") return Effect.interrupt;
              if (outcome.kind === "engine-missing")
                return Effect.flatMap(packReaderId, (readerId) =>
                  Effect.fail(
                    new PandocExportError({
                      notice: engineMissingMessage(outcome.status, readerId),
                    }),
                  ),
                );
              if (outcome.kind === "failed")
                return Effect.fail(
                  new PandocExportError({
                    notice: exportFailureMessage(outcome.problem),
                  }),
                );
              return Effect.succeed(outcome);
            }),
          ),
          {
            loading: m.notice_pandoc_export_running(),
            success: (outcome) =>
              m.notice_pandoc_export_done({
                file: basename(outcome.destination),
                style: outcome.styleTitle,
              }),
            error: (error) => {
              if (!(error instanceof PandocExportError))
                return exportFailureMessage({
                  kind: "engine",
                  detail: describeError(error),
                });
              return error.notice;
            },
          },
        ),
      ),
      Effect.provideContext(deps.context),
    ),
  );
}

export type PandocExportOutcome =
  | { kind: "engine-missing"; status: PackBinaryRefusal }
  | { kind: "failed"; problem: ExportProblem }
  | { kind: "stopped" }
  | { kind: "exported"; destination: string; styleTitle: string };

export const exportWithCitations = Effect.fn(
  "PandocExport.exportWithCitations",
)((file: TFile, deps: PandocExportDeps) =>
  prepareExport(file, deps).pipe(Effect.flatMap(({ run }) => run)),
);

const prepareExport = Effect.fn("PandocExport.prepareExport")(function* (
  file: TFile,
  deps: PandocExportDeps,
): Effect.fn.Return<
  { run: Effect.Effect<PandocExportOutcome> },
  never,
  PandocExportServices
> {
  const { app, bridge } = deps;
  const fileSystem = yield* FileSystem.FileSystem;
  const pandocEngine = yield* PandocEngine;
  const settings = yield* PluginSettings;
  const citationParse = yield* CitationParse;
  const zoteroHttp = yield* ZoteroHttp;
  const zoteroPref = yield* ZoteroPref;
  const citationLookup = yield* CitationLookup;
  const db = yield* ZoteroReads;
  const pref = yield* zoteroPref.current;
  const refusal = engineRefusal(yield* pandocEngine.current);
  if (refusal)
    return {
      run: Effect.succeed({ kind: "engine-missing", status: refusal }),
    };
  const profiles = yield* ProfileStyles;
  const declared = documentPresentation(
    app.metadataCache,
    file,
    profileReaderOf(
      profiles,
      Effect.runSyncWith(yield* Effect.context<never>()),
    ),
  );
  if (declared.kind === "unusable") {
    return {
      run: Effect.succeed({
        kind: "failed",
        problem:
          declared.property === "profile"
            ? {
                kind: "document-profile-invalid",
                stamp: declared.diagnostic.stamp,
                target: declared.target,
                recover: () => requestProfileSwitch(app, declared.target),
              }
            : {
                kind:
                  declared.property === "language"
                    ? "document-language-invalid"
                    : "document-style-invalid",
              },
      }),
    };
  }
  const effective = effectivePresentation(
    declared.presentation,
    vaultPresentation(yield* settings.current, profiles),
  );

  const choices = yield* awaitModal<PandocExportChoices | null>((resolve) =>
    openPandocExportModal(
      app,
      {
        dataDir: pref.dataDir,
        fileSystem,
        bridge,
        referencesStyleId: effective.styleId,
        styleSource: styleSourceOf(declared),
        notePath: absolutePath(app, file),
      },
      resolve,
    ),
  );
  if (!choices) return { run: Effect.succeed({ kind: "stopped" }) };

  const style = yield* exportPresentation(pref.dataDir, {
    styleId: choices.styleId,
    locale: effective.locale,
  });
  if (style === null) {
    const noteStyle = choices.styleId === declared.presentation.styleId;
    return {
      run: Effect.succeed({
        kind: "failed",
        problem:
          noteStyle &&
          declared.profileStyle &&
          typeof choices.styleId === "string"
            ? { kind: "profile-style-invalid", styleId: choices.styleId }
            : noteStyle
              ? { kind: "document-style-invalid" }
              : { kind: "style-invalid", style: choices.styleId ?? "" },
      }),
    };
  }

  const { title: styleTitle, ...engineStyle } = style;
  return {
    run: Effect.gen(function* (): Effect.fn.Return<PandocExportOutcome> {
      const conversion = yield* Effect.gen(function* () {
        const borrowed = yield* Effect.result(pandocEngine.getEngine);
        if (borrowed._tag === "Failure")
          return { missing: borrowed.failure.status };
        const engine = borrowed.success;
        if (!engine) return yield* Effect.interrupt;
        const markdown = yield* Effect.promise(() =>
          app.vault.cachedRead(file),
        );
        const localApiEnabled =
          (yield* zoteroPref.get(LOCAL_API_PREF)) === true;
        return yield* exportCitedDocument(
          {
            document: {
              sourcePath: file.path,
              links: app.metadataCache.getFileCache(file)?.links ?? [],
            },
            markdown,
            format: choices.format,
            ...engineStyle,
          },
          exportPorts(deps, engine, {
            ...pref,
            localApiEnabled,
            citationLookup,
            db,
            zoteroHttp,
          }),
        ).pipe(Effect.provideService(CitationParse, citationParse));
      }).pipe(
        Effect.scoped,
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
          return Effect.logError("The Pandoc export failed").pipe(
            Effect.annotateLogs({
              cause,
              source: file.path,
              destination: choices.destination,
              format: choices.format,
            }),
            withLogCategory("views", "pandoc-export"),
            Effect.as({
              error: {
                kind: "engine" as const,
                detail: describeError(Cause.squash(cause)),
              },
            }),
          );
        }),
      );
      if ("missing" in conversion)
        return { kind: "engine-missing", status: conversion.missing };
      if ("error" in conversion)
        return { kind: "failed", problem: conversion.error };
      const written = yield* fileSystem
        .writeFile(choices.destination, conversion.output)
        .pipe(Effect.uninterruptible, Effect.result);
      if (written._tag === "Failure")
        return {
          kind: "failed",
          problem: {
            kind: "destination-unwritable",
            detail: describeError(written.failure),
          },
        };

      return {
        kind: "exported",
        destination: choices.destination,
        styleTitle,
      };
    }),
  };
});

const exportPresentation = Effect.fn("PandocExport.exportPresentation")(
  function* (dataDir: string, request: CslStyleRequest) {
    const style = yield* resolveInstalledStyle(dataDir, request);
    if (style.kind === "installed")
      return { styleXml: style.xml, title: style.title };
    if (style.kind === "failed") return null;
    return { locale: style.locale, title: citationStyleLabel() };
  },
);

function exportPorts(
  deps: PandocExportDeps,
  engine: CitationEngine,
  pref: {
    dataDir: string;
    httpPort: number | null;
    localApiEnabled: boolean;
    citationLookup: CitationLookup["Service"];
    db: ZoteroReads["Service"];
    zoteroHttp: ZoteroHttp["Service"];
  },
): ExportPorts {
  const { app } = deps;
  const { citationLookup, db } = pref;
  return {
    engine,
    dataDir: () => pref.dataDir,
    resolveIndexedKey: (linkpath, sourcePath) =>
      resolveIndexedKey(linkpath, sourcePath, app),
    readLookup: (request) => citationLookup.read(request),
    readItemRefs: (indexedKeys) => readItemRefs(db, indexedKeys),
    fetchBibliography: (refs) =>
      fetchBibliography(refs, {
        httpPort: pref.httpPort,
        localApiEnabled: pref.localApiEnabled,
      }).pipe(Effect.provideService(ZoteroHttp, pref.zoteroHttp)),
  };
}

const readItemRefs = Effect.fn("PandocExport.readItemRefs")(
  function* (db: ZoteroReads["Service"], indexedKeys: readonly string[]) {
    const libraries = yield* db.reads.Libraries({});
    const refs = new Map<string, BibliographyItemRef>();
    for (const indexedKey of new Set(indexedKeys)) {
      const ref = placeItem(libraries, indexedKey);
      if (ref) refs.set(indexedKey, ref);
    }
    return refs;
  },
  Effect.orElseSucceed(() => null),
);

function placeItem(
  libraries: readonly Library[],
  indexedKey: string,
): BibliographyItemRef | null {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  const { key: itemKey, groupID } = parsed;
  const libraryID =
    groupID == null
      ? USER_LIBRARY_ID
      : libraries.find((library) => library.groupID === groupID)?.libraryID;
  if (libraryID === undefined) return null;
  return { itemKey, libraryID, groupID };
}

function absolutePath(app: App, file: TFile): string {
  return join(
    (app.vault.adapter as FileSystemAdapter).getBasePath(),
    file.path,
  );
}
