import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { missingStyleChanges } from "@zotlit/citations/obsidian/pandoc/render-cache.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { delay } from "@std/async";
import { Context, DateTime, Effect, FileSystem, Layer, Stream } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  App,
  EventRef,
  HoverParent,
  LinkCache,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import { act } from "preact/test-utils";
import { vi } from "vitest";

import { testEvent } from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";
import { createObsidianHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { MemoryVault } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { layerUnreadViewServices } from "@/services/__fixtures__/view-atoms.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { subscribe } from "@zotlit/plugin-kernel/effect-stream.ts";
import { spliceFrontMatter } from "@zotlit/obsidian-kit/live-text.ts";
import { makeViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { CitationLookup } from "@zotlit/citations/obsidian/citation-index/lookup-service.ts";
import { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import {
  createCitationIndexHarness,
  GROUP_LIBRARY_ID,
  groupLibrary,
  harnessApp,
  KEY_A,
  KEY_B,
  LibraryScopeStub,
  personalLibrary,
} from "@zotlit/citations/__fixtures__/citation-index/test-harness.ts";
import type { CitationIndexHarness } from "@zotlit/citations/__fixtures__/citation-index/test-harness.ts";
import { inProcessParseClient } from "@zotlit/citations/core/citation-parse/in-process.ts";
import { CitationParse } from "@zotlit/citations/obsidian/citation-parse/service.ts";
import { citationPopoverFixture } from "@zotlit/citations/__fixtures__/citation-popover.ts";
import { firstText } from "@zotlit/citations/__fixtures__/citation-text.ts";
import { citationTextFixture } from "@zotlit/citations/__fixtures__/citation-text.ts";
import { CitationText } from "@zotlit/citations/obsidian/citation-text/service.ts";
import type { PackBinaryApi } from "@zotlit/plugin-services/obsidian/managed-binary/pack-binary.ts";
import { createCitationEngine } from "@zotlit/citations/obsidian/pandoc/engine.ts";
import type { CitationEngine } from "@zotlit/citations/obsidian/pandoc/engine.ts";
import { BibliographyRender } from "@zotlit/citations/obsidian/pandoc/render-cache.ts";
import { bibliographyRenderFixture } from "@zotlit/citations/__fixtures__/pandoc/render-cache.ts";
import { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import { profileReader } from "@zotlit/notes/__fixtures__/profile/reader.ts";
import type { ProfileFixtureSettings as Settings } from "@zotlit/notes/__fixtures__/profile/reader.ts";
import type { ResolvedLiteratureNoteProfileBindings } from "@zotlit/notes/obsidian/profile/bindings.ts";
import { defaultProfileStyle } from "@zotlit/notes/obsidian/profile/profile-styles.ts";
import { ProfileStyles } from "@zotlit/citations/obsidian/pandoc/profile-styles.ts";
import {
  applySettings,
  buildSeededSettings,
} from "@/services/settings/__fixtures__.ts";
import type { SettingsFixture } from "@/services/settings/__fixtures__.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

type ProfileFixture = Pick<Settings, "profiles" | "defaultDocument">;
import { fakeFetchClient } from "@zotlit/plugin-kernel/__fixtures__/fake-fetch.ts";
import { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import { OpenDocumentsStub } from "@zotlit/citations/__fixtures__/citation-text/open-documents.ts";
import { seedWorksSql } from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { applyCitationPresentation } from "@zotlit/citations/obsidian/citation-presentation/presentation.ts";
import type { CitationPresentationChoice } from "@zotlit/citations/obsidian/citation-presentation/presentation.ts";
import { runPandocExport } from "@zotlit/citations/desktop/pandoc-export/register.ts";
import type { PandocExportDeps } from "@zotlit/citations/desktop/pandoc-export/register.ts";
import { ReferencesView } from "@zotlit/citations/desktop/references/view.tsx";

import {
  citedWorks,
  clipboardWrites,
  exportRun,
  resetCitationSurfaceMocks,
} from "./citation-surface-mocks.ts";
import type { CitedWork } from "./citation-surface-mocks.ts";

vi.mock("@zotlit/citations/desktop/pandoc-export/modal.ts", async () => ({
  openPandocExportModal: (await import("./citation-surface-mocks.ts"))
    .answerExportModal,
}));

vi.mock("@zotlit/citations/desktop/pandoc/bibliography.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zotlit/citations/desktop/pandoc/bibliography.ts")>()),
  fetchBibliography: (await import("./citation-surface-mocks.ts"))
    .fetchCitedBibliography,
}));

vi.mock("@zotlit/plugin-kernel/clipboard.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zotlit/plugin-kernel/clipboard.ts")>()),
  writeClipboardRichText: (await import("./citation-surface-mocks.ts"))
    .collectClipboardWrite,
}));


vi.mock("@zotlit/obsidian-kit/components/obsidian/icon-button.tsx", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<typeof import("@zotlit/obsidian-kit/components/obsidian/icon-button.tsx")>()),
    IconButton: ({ icon, ...props }: { icon: string }) =>
      createElement("button", { ...props, "data-icon": icon }),
  };
});

export const TIMEOUT = 60_000;

const CITATION_KEY = "doe2024";
export const SECOND_CITATION_KEY = "roe2025";

const DRAFT = "draft.md";
const DRAFT_BODY = `Cited @${CITATION_KEY}. Then @${SECOND_CITATION_KEY}.`;

export const EXPORT_NOTE = "export.md";
const LINKPATH = "Doe 2024";
export const EXPORT_BODY = `Cited [[${LINKPATH}]].\n`;

function zoteroRows(works: readonly CitedWork[]): string {
  return `
    ${seedWorksSql(works.map(({ work }) => work))}
    insert into libraries (libraryID, type) values (${GROUP_LIBRARY_ID}, 'group');
    insert into groups (groupID, libraryID, name) values (7, ${GROUP_LIBRARY_ID}, 'Group');
    insert into settings (setting, key, value) values ('account', 'userID', 1);
  `;
}

const CITED_WORK: CitedWork = {
  work: {
    itemID: 1,
    key: KEY_A,
    creators: [["Ann", "Zeta"]],
    title: "A study of nothing",
    date: "2020",
    citationKey: CITATION_KEY,
  },
  csl: {
    id: "zeta2020",
    type: "article-journal",
    title: "A study of nothing",
    author: [{ family: "Zeta", given: "Ann" }],
    issued: { "date-parts": [[2020]] },
  },
};

const SECOND_CITED_WORK: CitedWork = {
  work: {
    itemID: 2,
    key: KEY_B.slice(0, KEY_B.indexOf("g")),
    libraryID: GROUP_LIBRARY_ID,
    creators: [["Bo", "Alpha"]],
    title: "A second study of nothing",
    date: "2021",
    citationKey: SECOND_CITATION_KEY,
  },
  csl: {
    id: "alpha2021",
    type: "article-journal",
    title: "A second study of nothing",
    author: [{ family: "Alpha", given: "Bo" }],
    issued: { "date-parts": [[2021]] },
  },
};

const WASM_PATH = join(
  dirname(createRequire(import.meta.url).resolve("pandoc-wasm")),
  "pandoc.wasm",
);

function pandocEngineHandle(engine: CitationEngine) {
  return {
    binary: stubService<PackBinaryApi<CitationEngine>>("PandocEngine", {
      current: Effect.succeed({ kind: "ready", version: "test" }),
      changes: Stream.empty,
      getEngine: Effect.succeed(engine),
    }),
    runSync: Effect.runSync,
    runPromise: Effect.runPromise,
  };
}

export interface CitationVaultOptions {
  styles: Record<string, string>;
  settings: Partial<Settings> & Partial<ResolvedLiteratureNoteProfileBindings>;
  documentStyle?: unknown;
  documentLanguage?: unknown;
  documentProperties?: Record<string, unknown>;
  zoteroHoldsWork?: boolean;
}

export interface CitationVault extends AsyncDisposable {
  citationText(citekey?: string): Promise<string | undefined>;
  sidebarText(): Promise<string>;
  minimalSidebarText(): Promise<string>;
  popoverText(citekey?: string): Promise<string>;
  showPopover(citekey?: string): OpenPopover;
  copiedBibliography(): Promise<string>;
  copyOffered(): boolean;
  exportNote(override?: { styleId: string | null }): Promise<ExportedDocument>;
  vaultStyleMissing(): string | null;
  noteStyle(path: string): unknown;
  noteBody(path: string): string | undefined;
  setNoteStyle(declared: unknown): Promise<void>;
  setNoteLanguage(declared: unknown): Promise<void>;
  setPresentation(choice: CitationPresentationChoice): Promise<void>;
  setSettings(next: Partial<Settings>): Promise<void>;
}

export interface ExportedDocument {
  openedOn: string | null;
  html: string | null;
}

export interface OpenPopover extends Disposable {
  text(after?: string): Promise<string>;
}

class TestReferencesView extends ReferencesView {
  open(): Promise<void> {
    return this.onOpen();
  }

  close(): Promise<void> {
    return this.onClose();
  }
}

export async function openCitationVault({
  styles,
  settings: overrides,
  documentStyle,
  documentLanguage,
  documentProperties = {},
  zoteroHoldsWork = true,
}: CitationVaultOptions): Promise<CitationVault> {
  resetCitationSurfaceMocks();
  if (zoteroHoldsWork) {
    citedWorks.set(KEY_A, CITED_WORK);
    citedWorks.set(KEY_B, SECOND_CITED_WORK);
  }

  await using stack = new AsyncDisposableStack();
  const dataDir = stack.adopt(
    await mkdtemp(join(tmpdir(), "zotlit-citation-surfaces-")),
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  await mkdir(join(dataDir, "styles"), { recursive: true });
  for (const [name, xml] of Object.entries(styles)) {
    await writeFile(join(dataDir, "styles", name), xml);
  }

  const { profiles, defaultDocument, ...persisted } = overrides;
  let profileFixture: ProfileFixture = { profiles, defaultDocument };
  const profileChanged = testEvent<void>();
  const settings = stack.use(await buildSeededSettings(persisted));
  const profileSettings = (): Settings => ({
    ...settings.bridge.runSync(settings.current),
    ...profileFixture,
  });
  const harness = stack.use(
    await createCitationIndexHarness(
      { [DRAFT]: DRAFT_BODY, [EXPORT_NOTE]: EXPORT_BODY },
      {
        settingsService: settings,
        zoteroRows: zoteroRows([...citedWorks.values()]),
        libraryScope: new LibraryScopeStub([personalLibrary(), groupLibrary()]),
      },
    ),
  );
  harness.metadataCache.fileCache.set(EXPORT_NOTE, {
    links: [link(LINKPATH)],
  });
  const declared: { style: unknown; language: unknown } = {
    style: documentStyle,
    language: documentLanguage,
  };
  const properties = (): Record<string, unknown> => {
    const record: Record<string, unknown> = { ...documentProperties };
    if (declared.style !== undefined) record["zotlit-csl"] = declared.style;
    if (declared.language !== undefined) record["lang"] = declared.language;
    return record;
  };
  const writeProperties = (): void => {
    const written = properties();
    const frontmatter = Object.keys(written).length > 0 ? written : undefined;
    harness.vault.write(
      harness.metadataCache.files.get(EXPORT_NOTE)!,
      typeof declared.language === "string"
        ? `---\nlang: ${JSON.stringify(declared.language)}\n---\n\n${EXPORT_BODY}`
        : EXPORT_BODY,
    );
    for (const path of [DRAFT, EXPORT_NOTE]) {
      harness.metadataCache.setFrontmatter(
        harness.metadataCache.files.get(path)!,
        frontmatter,
      );
    }
  };
  writeProperties();

  const engine = stack.use(
    await createCitationEngine(new Blob([await readFile(WASM_PATH)])),
  );
  const cache = stack.use(
    await bibliographyRenderFixture({
      profile: {
        changes: Stream.merge(
          settings.changes.pipe(Stream.drop(1)),
          profileChanged.stream,
        ).pipe(Stream.map(() => ({ loaded: true, profiles: [], diagnostics: [], defaultDocumentPath: "", templateStatus: { state: "loaded" as const, compileErrors: new Map() } }))),
        vaultStyleId: defaultProfileStyle,
      },
      db: harness.db,
      pandocEngine: pandocEngineHandle(engine),
      zoteroPref: { dataDir, moves: Stream.empty },
      settings,
      queryClient: harness.queryClient,
    }),
  );
  let vaultStyleMissing: string | null = null;
  stack.defer(
    subscribe(cache.runtime, missingStyleChanges(cache.changes), (styleId) => {
      vaultStyleMissing = styleId;
    }),
  );

  const citationText = stack.use(
    citationTextFixture({
      openDocuments: new OpenDocumentsStub(),
      profile: profileReader(profileSettings, harness.metadataCache),
      host: harness.host,
      citationIndex: harness.index,
      citationLookup: harness.lookup,
      noteIndex: harness.noteIndex,
      bibliographyRender: cache,
      queryClient: harness.queryClient,
    }),
  );

  harness.workspace.open(harness.draft);
  const profile = profileReader(profileSettings, harness.metadataCache);
  const pandocEngine = pandocEngineHandle(engine);
  const viewRuntime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost(harness.host),
      Layer.succeed(CitationIndex, harness.runtime.runSync(CitationIndex)),
      Layer.succeed(
        CitationLookup,
        harness.lookup.runtime.runSync(CitationLookup),
      ),
      Layer.succeed(CitationText, citationText.runtime.runSync(CitationText)),
      Layer.succeed(
        BibliographyRender,
        cache.runtime.runSync(BibliographyRender),
      ),
      Layer.mock(PandocEngine, {
        current: pandocEngine.binary.current,
        changes: pandocEngine.binary.changes,
      }),
      Layer.mock(ProfileStyles, {
        loaded: Effect.sync(() => profile.loaded),
        profileOf: (file) => Effect.sync(() => profile.profileOf(file)),
        vaultStyleId: defaultProfileStyle,
        changes: Stream.merge(
          settings.changes.pipe(
            Stream.drop(1),
            Stream.map(() => undefined),
          ),
          profileChanged.stream,
        ).pipe(
          Stream.map(() => ({
            loaded: profile.loaded,
            profiles: profile.profiles,
            diagnostics: [],
            defaultDocumentPath: "",
            templateStatus: {
              state: "loaded" as const,
              compileErrors: new Map(),
            },
          })),
        ),
      }),
      Layer.mock(ZoteroReads, {
        reads: harness.db.reads,
        events: harness.db.changed.pipe(
          Stream.map(() => ({ _tag: "changed" as const })),
        ),
        changes: Stream.merge(Stream.make(undefined), harness.db.changed).pipe(
          Stream.map(() => ({
            state: harness.db.state,
            error: null,
            moved: false,
            dbFileMissing: false,
            activeReadMode: null,
          })),
        ),
      }),
    ),
    stack,
  );
  const registry = stack.adopt(
    makeViewRegistry(await viewRuntime.context(), { idleTTL: 0 }),
    (registry) => registry.dispose(),
  );

  const view = new TestReferencesView(
    Object.assign(
      stubService<WorkspaceLeaf>("WorkspaceLeaf", { updateHeader: () => {} }),
      { app: undefined },
    ),
    {
      registry,
      app: sidebarApp(harness),
      openSettings: () => undefined,
      openStyleSettings: () => undefined,
    },
  );
  document.body.append(view.contentEl);
  await act(() => view.open());
  stack.defer(async () => {
    await act(() => view.close());
    document.body.replaceChildren();
  });

  const popover = stack.use(
    citationPopoverFixture({
      profile: profileReader(profileSettings, harness.metadataCache),
      host: {
        metadataCache: harness.metadataCache,
        vault: MemoryVault.with({
          getFileByPath: (path: string) =>
            harness.metadataCache.files.get(path) ?? null,
        }),
      },
      db: harness.db,
      services: { citationIndex: harness.index, citationLookup: harness.lookup, citationText, bibliographyRender: cache },
      libraryScope: harness.libraryScope,
    }),
  );

  const copyAction = (): HTMLElement =>
    view.contentEl.querySelector<HTMLElement>(
      "[data-references-copy-bibliography]",
    )!;
  const copyOffered = (): boolean => !copyAction().hasAttribute("disabled");

  const showPopover = (citekey: string = CITATION_KEY): OpenPopover => {
    const parent: HoverParent = { hoverPopover: null };
    const targetEl = document.body.appendChild(document.createElement("span"));
    popover.runtime.runSync(
      popover.service.show({
        event: new MouseEvent("mouseover"),
        hoverParent: parent,
        sourcePath: DRAFT,
        targetEl,
        works: [
          {
            citekey,
            indexedKey: citekey === CITATION_KEY ? KEY_A : KEY_B,
          },
        ],
        shown: { citation: { source: `@${citekey}`, keys: [] } },
        open: () => undefined,
      }),
    );
    return {
      async text(after) {
        let shown = "";
        await settle(() => {
          shown = parent.hoverPopover?.hoverEl.textContent ?? "";
          return shown.length > 0 && shown !== after;
        });
        return shown;
      },
      [Symbol.dispose]() {
        parent.hoverPopover?.hide();
        targetEl.remove();
      },
    };
  };

  const exportDeps = exportAdapter({
    dataDir,
    engine,
    harness,
    settings,
    profileSettings,
    notifier: await buildRuntime(testNotifier().layer, stack).runPromise(Notifier),
  });

  const changeSidebar = async (change: () => void): Promise<void> => {
    const changed = Promise.withResolvers<void>();
    using cleanup = new DisposableStack();
    cleanup.defer(
      registry.subscribe(view.model.state, (state) => {
        if (state.copy.kind === "blocked") changed.resolve();
      }),
    );
    await act(async () => {
      change();
      await changed.promise;
    });
  };

  let exportAttempts = 0;
  const held = stack.move();
  return {
    async citationText(citekey = CITATION_KEY) {
      let held = citationText.bridge.runSync(citationText.peek(harness.draft.path));
      await settle(() => {
        held = citationText.bridge.runSync(citationText.peek(harness.draft.path));
        return held !== null && held.status !== "revalidating";
      });
      const { formatted } = held!.value;
      return firstText(formatted.get(`@${citekey}`));
    },
    async sidebarText() {
      await settle(copyOffered);
      return view.contentEl.textContent ?? "";
    },
    async minimalSidebarText() {
      const banner = (): string =>
        view.contentEl.querySelector("[data-references-banner]")?.textContent ??
        "";
      await settle(() => banner().length > 0);
      return view.contentEl.textContent ?? "";
    },
    async popoverText(citekey) {
      using shown = showPopover(citekey);
      return await shown.text();
    },
    showPopover,
    async copiedBibliography() {
      await settle(copyOffered);
      const taken = clipboardWrites.length;
      await act(() => {
        copyAction().click();
      });
      await settle(() => clipboardWrites.length > taken);
      return clipboardWrites.at(-1)!.text;
    },
    copyOffered,
    async exportNote(override) {
      const destination = join(dataDir, `exported-${++exportAttempts}.html`);
      exportRun.destination = destination;
      exportRun.referencesStyleId = null;
      exportRun.override = override?.styleId;
      await runPandocExport(
        harness.metadataCache.files.get(EXPORT_NOTE)!,
        exportDeps,
      );
      return {
        openedOn: exportRun.referencesStyleId,
        html: await readFile(destination, "utf8").catch(() => null),
      };
    },
    vaultStyleMissing: () => vaultStyleMissing,
    noteStyle: (path) =>
      harness.metadataCache.fileCache.get(path)?.frontmatter?.["zotlit-csl"],
    noteBody: (path) => harness.vault.bodies.get(path),
    async setNoteStyle(style) {
      await changeSidebar(() => {
        declared.style = style;
        writeProperties();
      });
    },
    async setNoteLanguage(language) {
      await changeSidebar(() => {
        declared.language = language;
        writeProperties();
      });
    },
    async setPresentation(choice) {
      const host = createObsidianHost({
        [DRAFT]: spliceFrontMatter("", properties()),
      });
      await applyCitationPresentation(host.app, host.file(DRAFT), choice);
      const written =
        host.metadataCache.getFileCache(host.file(DRAFT))?.frontmatter ?? {};
      await changeSidebar(() => {
        declared.style = written["zotlit-csl"];
        declared.language = written["lang"];
        writeProperties();
      });
    },
    async setSettings(next) {
      const { profiles, defaultDocument, ...persisted } = next;
      await changeSidebar(() => {
        applySettings(settings, settings.bridge, persisted);
        if ("profiles" in next || "defaultDocument" in next) {
          profileFixture = { ...profileFixture, profiles, defaultDocument };
          profileChanged.emit();
        }
      });
    },
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

function sidebarApp({ host, draft }: CitationIndexHarness): App {
  return harnessApp(
    host,
    stubService<Workspace>("Workspace", {
      getActiveFile: () => draft,
      on: () => stubService<EventRef>("EventRef", {}),
    }),
  );
}

async function settle(settled: () => boolean): Promise<void> {
  const deadline = DateTime.add(DateTime.nowUnsafe(), {
    milliseconds: TIMEOUT / 2,
  });
  while (!settled()) {
    if (DateTime.isGreaterThan(DateTime.nowUnsafe(), deadline)) {
      throw new Error("a surface never settled");
    }
    await act(async () => {
      await delay(25);
    });
  }
}

function exportAdapter({
  dataDir,
  engine,
  harness,
  settings,
  profileSettings,
  notifier,
}: {
  notifier: Notifier["Service"];
  dataDir: string;
  engine: Awaited<ReturnType<typeof createCitationEngine>>;
  harness: CitationIndexHarness;
  settings: SettingsFixture;
  profileSettings: () => Settings;
}): PandocExportDeps {
  return {
    app: stubService<App>("App", {}),
    vault: { basePath: dataDir, vaultName: "Test Vault" },
    bridge: settings.bridge,
    context: Context.make(
      ZoteroPref,
      stubService<ZoteroPref["Service"]>("ZoteroPref", {
        current: Effect.succeed(stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", { dataDir, httpPort: 23119 })),
        get: () => Effect.succeed(true),
      }),
    ).pipe(
      Context.add(ZoteroReads, stubService<ZoteroReads["Service"]>("ZoteroReads", { reads: harness.db.reads })),
      Context.add(CitationLookup, harness.lookup.runtime.runSync(CitationLookup)),
      Context.add(
        ProfileStyles,
        stubService<ProfileStyles["Service"]>("ProfileStyles", {
          loaded: Effect.succeed(true),
          profileOf: (file) => Effect.sync(() => profileReader(profileSettings, harness.metadataCache).profileOf(file)),
          vaultStyleId: defaultProfileStyle,
        }),
      ),
      Context.add(CitationParse, inProcessParseClient),
      Context.add(PluginHost, testPluginHost({ manifest: { id: "zotlit" } }).host),
      Context.add(
        FileSystem.FileSystem,
        Effect.runSync(FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer))),
      ),
      Context.add(Notifier, notifier),
      Context.add(
        Vault,
        stubService<Vault["Service"]>("Vault", {
          cachedRead: (file) => Effect.promise(() => harness.vault.cachedRead(file)),
        }),
      ),
      Context.add(
        MetadataCache,
        stubService<MetadataCache["Service"]>("MetadataCache", {
          fileCache: (file) => Effect.sync(() => harness.metadataCache.getFileCache(file)),
          firstLinkpathDest: (linkpath, sourcePath) =>
            Effect.sync(() => harness.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)),
        }),
      ),
      Context.add(PandocEngine, pandocEngineHandle(engine).binary),
      Context.add(PluginSettings, settings),
      Context.add(
        ZoteroHttp,
        fakeFetchClient(() => {
          throw new Error("No Zotero in this fixture");
        }),
      ),
    ),
  };
}

function link(target: string): LinkCache {
  return {
    link: target,
    original: `[[${target}]]`,
    position: {
      start: { line: 0, col: 0, offset: 0 },
      end: { line: 0, col: target.length + 4, offset: 0 },
    },
  };
}
