import type { ProfileStyleReader } from "#obsidian/pandoc/profile-styles.ts";
import type {
  ResolveDocument,
  ResolvedItem,
  ResolveResponse,
} from "#obsidian/pandoc/resolve.ts";
import { Effect, FileSystem, Layer } from "effect";
import { isAbsolute, relative } from "node:path";
import { normalizePath } from "obsidian";
import type { CliData, CliFlag, CliFlags, TFile } from "obsidian";

import type { VersionedCliHost } from "@zotlit/obsidian-kit/cli-command.ts";
import {
  catchRejection,
  cliMap,
  cliNotApplicable,
  cliParams,
  cliValue,
  cliVariants,
  decodeCliParams,
  rejectionText,
} from "@zotlit/obsidian-kit/cli-params.ts";
import type { CliParamName } from "@zotlit/obsidian-kit/cli-params.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { resolveLiteratureNoteIn } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import {
  CSL_COMMAND,
  CSL_SELECTOR_MESSAGE,
  flagsInvalidResponse,
  cslWriteFailedResponse,
  resolveCslStyle,
  resolveDocumentCslStyle,
} from "./csl.ts";
import type { CslResponse, DocumentStyleRead } from "./csl.ts";
import {
  createPandocIntegrationHandlers,
  PANDOC_FILES_COMMAND,
  PANDOC_GUIDE_COMMAND,
} from "./integration.ts";
import { reapCslStore } from "./reap-temps.ts";
import { resolveInstalledStyle } from "./styles.ts";

import {
  documentPresentation,
  effectivePresentation,
  profileReaderOf,
  styleSourceOf,
  vaultPresentation,
} from "#obsidian/pandoc/document-presentation.ts";
import { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";
import { resolveCitations } from "#obsidian/pandoc/resolve.ts";

export const RESOLVE_COMMAND = "zotlit:resolve";
export { CSL_COMMAND };

export interface PandocResolveDeps {
  fileSystem: FileSystem.FileSystem;
  vault: Pick<Vault["Service"], "getFileByPath">;
  metadata: Pick<MetadataCache["Service"], "fileCache" | "firstLinkpathDest">;
  basePath: string;
  reads: Pick<ZoteroReads["Service"], "current" | "reads">;
  zoteroPref: Pick<ZoteroPref["Service"], "current">;
  settings: Pick<PluginSettings["Service"], "current">;
  profile: Pick<
    ProfileStyles["Service"],
    "loaded" | "profileOf" | "vaultStyleId"
  >;
}

export const layerPandocResolve: Layer.Layer<
  never,
  never,
  | PluginHost
  | ObsidianEnv
  | MetadataCache
  | Vault
  | ZoteroReads
  | ZoteroPref
  | PluginSettings
  | ProfileStyles
  | FileSystem.FileSystem
> = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* reapCslStore().pipe(Effect.forkScoped);
    const host = yield* PluginHost;
    registerPandocResolve(host, {
      vault: yield* Vault,
      metadata: yield* MetadataCache,
      basePath: (yield* ObsidianEnv).basePath,
      fileSystem: yield* FileSystem.FileSystem,
      reads: yield* ZoteroReads,
      zoteroPref: yield* ZoteroPref,
      settings: yield* PluginSettings,
      profile: yield* ProfileStyles,
    });
  }),
);

const resolveParams = cliParams({ file: cliValue("file") }).pipe(
  cliMap(({ file }) => file),
);

function resolveFlags(): CliFlags {
  return {
    file: {
      value: "<absolute-path>",
      description: "Absolute path to the Markdown file",
      required: true,
    },
  } satisfies Record<CliParamName<typeof resolveParams>, CliFlag>;
}

const cslParams = cliVariants(
  ({ style }) => (style === undefined ? "file" : "style"),
  {
    style: cliParams({
      style: cliValue("style"),
      file: cliNotApplicable(CSL_SELECTOR_MESSAGE),
    }),
    file: cliParams({ file: cliValue("file") }, { file: CSL_SELECTOR_MESSAGE }),
  },
);

function cslFlags(): CliFlags {
  return {
    style: {
      value: "<csl-id>",
      description: "CSL ID of the Zotero-installed style; pass this or file",
    },
    file: {
      value: "<absolute-path>",
      description:
        "Absolute path to the Markdown file whose style to resolve; pass this or style",
    },
  } satisfies Record<CliParamName<typeof cslParams>, CliFlag>;
}

export function registerPandocResolve(
  host: VersionedCliHost,
  deps: PandocResolveDeps,
): void {
  const integration = createPandocIntegrationHandlers(host.manifest.version);
  host.registerCliCommand(PANDOC_FILES_COMMAND, {
    description: "Return the version-matched ZotLit Pandoc integration pair",
    flags: null,
    handler: integration[PANDOC_FILES_COMMAND],
  });
  host.registerCliCommand(PANDOC_GUIDE_COMMAND, {
    description: "Print the ZotLit Pandoc CLI guide",
    flags: null,
    handler: integration[PANDOC_GUIDE_COMMAND],
  });
  host.registerCliCommand(RESOLVE_COMMAND, {
    description:
      "Resolve the literature note links of one file to citation keys, for the ZotLit Pandoc filter",
    flags: resolveFlags(),
    handler: Effect.fn("PandocCli.resolve")(
      function* (params: CliData) {
        const file = yield* decodeCliParams(params, resolveParams, {
          command: RESOLVE_COMMAND,
        });
        const response = yield* resolveCitations(file, {
          readDocument: (absolutePath) => readDocument(deps, absolutePath),
          resolveIndexedKey: (linkpath, sourcePath) =>
            Effect.map(
              resolveLiteratureNoteIn(deps.metadata, linkpath, sourcePath),
              (note) => note?.indexedKey ?? null,
            ),
          database: {
            describe: () =>
              Effect.zipWith(
                deps.zoteroPref.current,
                deps.reads.current,
                ({ dataDir }, { activeReadMode }) => ({
                  dataDir,
                  readMode: activeReadMode,
                }),
              ),
            read: (indexedKeys) => {
              const unreadable = (error: unknown) =>
                Effect.logWarning("Cannot read the Zotero database").pipe(
                  Effect.annotateLogs({ error }),
                  withLogCategory("pandoc", "resolve"),
                  Effect.as(null),
                );
              return readItems(deps.reads, indexedKeys).pipe(
                Effect.catch((error) => unreadable(error)),
                Effect.catchDefect((defect) => unreadable(defect)),
              );
            },
          },
        });
        return JSON.stringify(response, null, 2);
      },
      catchRejection((rejection) =>
        JSON.stringify(
          {
            errors: [
              { code: "flags-invalid", message: rejectionText(rejection) },
            ],
          } satisfies ResolveResponse,
          null,
          2,
        ),
      ),
    ),
  });
  host.registerCliCommand(CSL_COMMAND, {
    description:
      "Materialize the CSL file of one Zotero-installed style or of one note's style, for the ZotLit Pandoc filter",
    flags: cslFlags(),
    handler: Effect.fn("PandocCli.csl")(
      function* (params: CliData) {
        const selected = yield* decodeCliParams(params, cslParams, {
          command: CSL_COMMAND,
        });
        const { dataDir } = yield* deps.zoteroPref.current;
        const settings = yield* deps.settings.current;
        const run = Effect.runSyncWith(yield* Effect.context<never>());
        const profile = profileReaderOf(deps.profile, run);
        const ports = {
          resolve: (styleId: string) =>
            resolveInstalledStyle(dataDir, { styleId }),
        };
        const response: CslResponse = yield* "style" in selected
          ? resolveCslStyle(selected.style, ports)
          : resolveDocumentCslStyle(selected.file, {
              ...ports,
              readStyle: (absolutePath) =>
                readDocumentStyle(
                  {
                    vault: deps.vault,
                    metadata: deps.metadata,
                    basePath: deps.basePath,
                    settings,
                    profile,
                    profiles: deps.profile,
                  },
                  absolutePath,
                ),
            });
        return JSON.stringify(response, null, 2);
      },
      catchRejection((rejection) =>
        JSON.stringify(flagsInvalidResponse(rejectionText(rejection)), null, 2),
      ),
      Effect.catchTag("CslWriteError", (error) =>
        Effect.as(
          Effect.logWarning("Cannot materialize the Resolved CSL Style").pipe(
            Effect.annotateLogs({ styleId: error.styleId, error: error.cause }),
            withLogCategory("pandoc", "csl"),
          ),
          JSON.stringify(cslWriteFailedResponse(error), null, 2),
        ),
      ),
      Effect.provideService(FileSystem.FileSystem, deps.fileSystem),
    ),
  });
}

const readDocumentStyle = Effect.fn("PandocCli.readDocumentStyle")(function* (
  {
    vault,
    metadata,
    basePath,
    settings,
    profile,
    profiles,
  }: {
    metadata: Pick<MetadataCache["Service"], "fileCache">;
    vault: Pick<Vault["Service"], "getFileByPath">;
    basePath: string;
    settings: Readonly<Settings>;
    profile: ProfileStyleReader;
    profiles: Pick<ProfileStyles["Service"], "vaultStyleId">;
  },
  absolutePath: string,
): Effect.fn.Return<DocumentStyleRead> {
  const file = yield* vaultFile(vault, basePath, absolutePath);
  if (!file) return { kind: "file-not-found" };
  const cache = yield* metadata.fileCache(file);
  const declared = documentPresentation(
    { getFileCache: () => cache },
    file,
    profile,
  );
  if (declared.kind === "unusable") return declared;
  const { styleId } = effectivePresentation(
    declared.presentation,
    vaultPresentation(settings, profiles),
  );
  return { kind: "read", styleId, source: styleSourceOf(declared) };
});

const readDocument = Effect.fn("PandocCli.readDocument")(function* (
  {
    vault,
    basePath,
    metadata,
  }: Pick<PandocResolveDeps, "vault" | "basePath" | "metadata">,
  absolutePath: string,
): Effect.fn.Return<ResolveDocument | null> {
  const file = yield* vaultFile(vault, basePath, absolutePath);
  if (!file) return null;
  return {
    sourcePath: file.path,
    links: (yield* metadata.fileCache(file))?.links ?? [],
  };
});

function vaultFile(
  vault: PandocResolveDeps["vault"],
  basePath: string,
  absolutePath: string,
): Effect.Effect<TFile | null> {
  if (!isAbsolute(absolutePath)) return Effect.succeed(null);
  return vault.getFileByPath(normalizePath(relative(basePath, absolutePath)));
}

const readItems = Effect.fn("PandocCli.readItems")(function* (
  reads: PandocResolveDeps["reads"],
  indexedKeys: readonly string[],
) {
  const { reads: api } = reads;
  const unique = [...new Set(indexedKeys)];
  const found = yield* api.ItemsByIndexedKeys({ indexedKeys: unique });
  const items = new Map<string, ResolvedItem>();
  for (const indexedKey of unique) {
    const item = found.get(indexedKey);
    if (!item) continue;
    items.set(indexedKey, {
      citationKey:
        ("citationKey" in item.fields ? item.fields.citationKey : null) ?? null,
      title: ("title" in item.fields ? item.fields.title : null) ?? item.key,
    });
  }
  return items;
});
