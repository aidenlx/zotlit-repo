import { it as effectIt } from "@effect/vitest";
import {
  Cause,
  Context,
  Effect,
  Exit,
  FileSystem,
  ManagedRuntime,
} from "effect";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TFile } from "obsidian";
import type { App, Command, FileSystemAdapter, Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nodeFileSystem } from "@zotlit/citations/__fixtures__/pandoc/file-effects.ts";
import type { InstalledCslStyle } from "@zotlit/citations/core/pandoc/csl-style.ts";
import {
  exportWithCitations,
  registerPandocExport,
} from "@zotlit/citations/desktop/pandoc-export/register.ts";
import type {
  PandocExportDeps,
  PandocExportOutcome,
} from "@zotlit/citations/desktop/pandoc-export/register.ts";
import { CitationLookup } from "@zotlit/citations/obsidian/citation-index/lookup-service.ts";
import { CitationParse } from "@zotlit/citations/obsidian/citation-parse/service.ts";
import type { CitationEngine } from "@zotlit/citations/obsidian/pandoc/engine.ts";
import { ProfileStyles } from "@zotlit/citations/obsidian/pandoc/profile-styles.ts";
import { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import { profileReader } from "@zotlit/notes/__fixtures__/profile/reader.ts";
import type { ProfileFixtureSettings as Settings } from "@zotlit/notes/__fixtures__/profile/reader.ts";
import type { ResolvedLiteratureNoteProfileBindings } from "@zotlit/notes/obsidian/profile/bindings.ts";
import { defaultProfileStyle } from "@zotlit/notes/obsidian/profile/profile-styles.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
// @vitest-environment happy-dom
import {
  ButtonComponent,
  controlsOf,
  DropdownComponent,
  Modal,
  settingsOf,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { ProfileId } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ManagedBinaryError } from "@zotlit/plugin-services/obsidian/managed-binary/platform.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { lookupAnswer } from "@zotlit/zotero-reads/__fixtures__/citation-lookup.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { defaults } from "@/services/settings/schema.ts";

/** The styles Zotero has installed while the export dialog is open. */
const zotero = vi.hoisted(() => ({ styles: [] as InstalledCslStyle[] }));
/** How the stubbed export run ends. */
const exportRun = vi.hoisted(() => ({
  /** Interrupt the run, as unloading the plugin does. */
  unload: false,
}));

vi.mock(
  "@zotlit/citations/desktop/pandoc/styles.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@zotlit/citations/desktop/pandoc/styles.ts")
      >();
    return {
      ...actual,
      // An installed style resolves as Zotero lists it; anything else takes the
      // real resolver's answer for a data directory that holds no styles.
      resolveInstalledStyle: (
        ...args: Parameters<typeof actual.resolveInstalledStyle>
      ) => {
        const listed = zotero.styles.find(({ id }) => id === args[1].styleId);
        return listed
          ? Effect.succeed({
              kind: "installed" as const,
              styleId: listed.id,
              title: listed.title,
              parentId: undefined,
              xml: "<style/>",
            })
          : actual.resolveInstalledStyle(...args);
      },
    };
  },
);
vi.mock(
  "@zotlit/citations/desktop/pandoc/export.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@zotlit/citations/desktop/pandoc/export.ts")
    >()),
    exportCitedDocument: () =>
      exportRun.unload
        ? Effect.interrupt
        : Effect.succeed({ output: new Uint8Array() }),
  }),
);
vi.mock("@zotlit/citations/desktop/pandoc/installed-styles.ts", () => ({
  listInstalledStylesOrNone: () => Effect.succeed(zotero.styles),
}));
const DATA_DIR = "/zotero";
const BASE_PATH = "/vault";
const NOTE_STYLE = {
  id: "http://www.zotero.org/styles/note-numbered",
  title: "Note numbered",
};
const VAULT_STYLE = {
  id: "http://www.zotero.org/styles/vault-prose",
  title: "Vault prose",
};
const MISSING_STYLE_ID = "http://www.zotero.org/styles/missing-profile-style";
const PROFILE_ID = "Aa1Bb2Cc3Dd4" as ProfileId;

interface VaultOptions {
  fileSystem?: FileSystem.FileSystem;
  /** The properties the active note carries; `undefined` leaves no note active. */
  note?: Record<string, unknown>;
  settings?: Partial<Settings> &
    Pick<
      Partial<ResolvedLiteratureNoteProfileBindings>,
      "citation.references-style"
    >;
  engineInstalled?: boolean;
  /**
   * `false` for an installed pack that is unread and refuses its first read
   * as damaged.
   */
  engineStarts?: boolean;
  /** Where the vault stands on disk, which is where an export is written. */
  basePath?: string;
}

/** One vault the built-in export command is registered in, on one note. */
function openVault({
  note,
  settings = {},
  engineInstalled = true,
  engineStarts = true,
  basePath = BASE_PATH,
  fileSystem = nodeFileSystem,
}: VaultOptions = {}) {
  const file = markdownFile("draft.md");
  const frontmatter = note ?? {};
  // The export stub above still needs an available engine handle.
  const getEngine = vi.fn(() => Promise.resolve({}));
  let borrowed = false;
  let command: Command | undefined;
  const {
    ["citation.references-style"]: referencesStyle,
    ...persistedSettings
  } = settings;
  const resolvedSettings: Settings = {
    ...defaults,
    ...persistedSettings,
    "note.default-profile": {
      ...defaults["note.default-profile"],
      ...persistedSettings["note.default-profile"],
      bindings: {
        ...defaults["note.default-profile"].bindings,
        ...persistedSettings["note.default-profile"]?.bindings,
        ...(referencesStyle === undefined
          ? {}
          : { "citation.references-style": referencesStyle }),
      },
    },
  };

  const app = stubService<App>("App", {
    workspace: stubService<App["workspace"]>("Workspace", {
      getActiveFile: () => (note ? file : null),
    }),
    metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
      getFileCache: () => ({ frontmatter }),
    }),
    vault: stubService<App["vault"]>("Vault", {
      adapter: stubService<FileSystemAdapter>("FileSystemAdapter", {
        getBasePath: () => basePath,
      }),
      getName: () => "Research",
      cachedRead: () => Promise.resolve("[[Doe 2020]]\n"),
    }),
  });

  const reader = profileReader(resolvedSettings, {
    getFileCache: () => ({ frontmatter }),
  });
  const notifier = testNotifier();
  const runtime = ManagedRuntime.make(notifier.layer);
  runtimes.push(runtime);
  const bridge = effectBridge(runtime);
  const context = Context.make(
    ZoteroPref,
    stubService<ZoteroPref["Service"]>("ZoteroPref", {
      current: Effect.succeed(
        stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
          dataDir: DATA_DIR,
          httpPort: 23119,
        }),
      ),
      get: () => Effect.succeed(false),
    }),
  ).pipe(
    Context.add(
      ZoteroReads,
      stubService<ZoteroReads["Service"]>("ZoteroReads", {}),
    ),
    Context.add(
      CitationLookup,
      stubService<CitationLookup["Service"]>("CitationLookup", {
        read: () => Effect.succeed(lookupAnswer()),
      }),
    ),
    Context.add(
      ProfileStyles,
      stubService<ProfileStyles["Service"]>("ProfileStyles", {
        loaded: Effect.succeed(true),
        profileOf: (file) => Effect.succeed(reader.profileOf(file)),
        vaultStyleId: defaultProfileStyle,
      }),
    ),
    Context.add(FileSystem.FileSystem, fileSystem),
    Context.add(
      PandocEngine,
      stubService<PandocEngine["Service"]>("PandocEngine", {
        current: Effect.sync(() =>
          !engineInstalled
            ? { kind: "pack-absent" }
            : engineStarts
              ? { kind: "ready", version: "test" }
              : borrowed
                ? { kind: "pack-damaged" }
                : null,
        ),
        getEngine: Effect.suspend(
          (): Effect.Effect<unknown, ManagedBinaryError> => {
            if (engineStarts) return Effect.promise(() => getEngine());
            borrowed = true;
            return Effect.fail(
              new ManagedBinaryError({
                message: "The Resource Pack gave no Pandoc engine",
              }),
            );
          },
        ).pipe(
          Effect.map(() =>
            stubService<CitationEngine>("CitationEngine", {
              [Symbol.asyncDispose]: async () => {},
            }),
          ),
        ),
      }),
    ),
    Context.add(
      CitationParse,
      stubService<CitationParse["Service"]>("CitationParse", {}),
    ),
    Context.add(
      ZoteroHttp,
      stubService<ZoteroHttp["Service"]>("ZoteroHttp", {}),
    ),
    Context.add(
      PluginSettings,
      stubService<PluginSettings["Service"]>("PluginSettings", {
        current: Effect.succeed(resolvedSettings),
      }),
    ),
    Context.add(
      Notifier,
      Notifier.of({
        ...notifier.service,
        track: (notice) => runtime.runSync(Notifier).track(notice),
      }),
    ),
  );
  const deps: PandocExportDeps = {
    app,
    bridge,
    context,
  };
  registerPandocExport(
    stubService<Pick<Plugin, "addCommand" | "app">>("Plugin", {
      app,
      addCommand: (added: Command) => {
        command = added;
        return added;
      },
    }),
    deps,
  );

  if (!command) throw new Error("the export registered no command");
  const palette = command;
  return {
    file,
    close: () => runtime.dispose(),
    notices: notifier.notices,
    /** Whether the engine was ever asked to convert anything. */
    converted: () => getEngine.mock.calls.length > 0,
    /** The command palette entry, as the palette offers it. */
    offered: () => palette.checkCallback?.(true) === true,
    /** Run one export of the note, as the palette entry does. */
    export: runExport,
    /** Run one export, and read the dialog it opens. */
    openDialog: () => dialog(runExport()),
    /** Run the command from the palette. */
    runFromPalette: () => void palette.checkCallback?.(false),
    /** Run the command from the palette, and read the dialog it opens. */
    openDialogFromPalette() {
      palette.checkCallback?.(false);
      return dialog(null);
    },
  };

  async function runExport(): Promise<PandocExportOutcome> {
    const exit = await bridge.runPromiseExit(
      exportWithCitations(file, deps).pipe(Effect.provideContext(context)),
    );
    if (Exit.isSuccess(exit)) return exit.value;
    if (Cause.hasInterruptsOnly(exit.cause)) return { kind: "stopped" };
    throw Cause.squash(exit.cause);
  }

  /**
   * The dialog an export opened.
   *
   * @param outcome how the export ends, where the test holds it.
   */
  async function dialog(outcome: Promise<PandocExportOutcome> | null) {
    await vi.waitFor(() => expect(Modal.instances).toHaveLength(1));
    const modal = Modal.instances.at(-1)!;
    const rows = settingsOf(modal.contentEl);
    const [format, style] = rows
      .flatMap((row) => row.components)
      .filter((component) => component instanceof DropdownComponent);
    // The listing lands after the dialog is built, so the entries the user
    // reads are the ones the resolved listing left in the picker.
    await vi.waitFor(() => expect(style!.options.length).toBeGreaterThan(1));
    return {
      format: format!,
      style: style!,
      /** What the dialog says under the style picker. */
      styleNote: () =>
        rows.find((row) => row.name === m.pandoc_export_style_name())?.desc,
      /** The destination the dialog names, as the user reads it. */
      destination: () =>
        rows.find((row) => row.name === m.pandoc_export_destination_name())
          ?.desc,
      /** Dismiss the dialog without answering, as closing its window does. */
      dismiss: () => modal.close(),
      confirm: () =>
        rows
          .flatMap((row) => row.components)
          .find(
            (component): component is ButtonComponent =>
              component instanceof ButtonComponent &&
              component.text === m.pandoc_export_confirm(),
          )
          ?.click(),
      title: modal.title,
      /** How the export ended. */
      outcome,
    };
  }
}

function markdownFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.extension = "md";
  return file;
}

const runtimes: ManagedRuntime.ManagedRuntime<Notifier, never>[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

beforeEach(() => {
  Modal.instances.length = 0;
  zotero.styles = [NOTE_STYLE, VAULT_STYLE];
  exportRun.unload = false;
});

describe("the Export note with citations command", () => {
  effectIt.live("closes a pending export dialog on unload", () =>
    Effect.gen(function* () {
      const vault = openVault({ note: {} });
      const dialog = yield* Effect.promise(() => vault.openDialog());
      expect(Modal.instances.at(-1)?.isOpen).toBe(true);
      yield* Effect.promise(() => vault.close());
      expect(Modal.instances.at(-1)?.isOpen).toBe(false);
      expect(yield* Effect.promise(() => dialog.outcome!)).toEqual({
        kind: "stopped",
      });
      expect(vault.converted()).toBe(false);
    }),
  );

  effectIt.live("finishes a started destination write before unload ends", () =>
    Effect.gen(function* () {
      const basePath = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "zotlit-export-"))),
        (dir) =>
          Effect.promise(() => rm(dir, { recursive: true, force: true })),
      );
      const started = Promise.withResolvers<void>();
      const writing = Promise.withResolvers<void>();
      const fileSystem: FileSystem.FileSystem = {
        ...nodeFileSystem,
        writeFile: (...args) =>
          Effect.gen(function* () {
            started.resolve();
            yield* Effect.promise(() => writing.promise);
            yield* nodeFileSystem.writeFile(...args);
          }),
      };
      const vault = openVault({ note: {}, basePath, fileSystem });
      const dialog = yield* Effect.promise(() => vault.openDialog());
      dialog.confirm();
      yield* Effect.promise(() => started.promise);
      let closed = false;
      const closing = vault.close().then(() => {
        closed = true;
      });
      yield* Effect.yieldNow;
      expect(closed).toBe(false);
      writing.resolve();
      yield* Effect.promise(() => closing);
      expect(
        yield* Effect.promise(() => readFile(join(basePath, "draft.docx"))),
      ).toHaveLength(0);
    }),
  );

  it("reports a typed filesystem refusal as an unwritable destination", async () => {
    await using stack = new AsyncDisposableStack();
    const root = stack.adopt(
      await mkdtemp(join(tmpdir(), "zotlit-export-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const vault = openVault({ note: {}, basePath: join(root, "missing") });
    const dialog = await vault.openDialog();
    dialog.confirm();
    expect(await dialog.outcome).toEqual({
      kind: "failed",
      problem: {
        kind: "destination-unwritable",
        detail: expect.any(String),
      },
    });
    expect(await readdir(root)).toEqual([]);
  });

  it("is offered for the active Markdown note", () => {
    expect(openVault({ note: {} }).offered()).toBe(true);
  });

  it("stays out of reach where no note is active", () => {
    expect(openVault().offered()).toBe(false);
  });

  it("stays out of reach for a file that is no note", () => {
    const vault = openVault({ note: {} });
    vault.file.extension = "canvas";

    expect(vault.offered()).toBe(false);
  });

  it("opens the dialog on the style the note itself names", async () => {
    const vault = openVault({
      note: { "zotlit-csl": NOTE_STYLE.id },
      settings: { "citation.references-style": VAULT_STYLE.id },
    });

    const dialog = await vault.openDialog();

    expect(dialog.title).toBe(m.pandoc_export_title());
    expect(dialog.style.getValue()).toBe(NOTE_STYLE.id);
    expect(dialog.destination()).toBe(
      m.pandoc_export_destination_in_vault({
        path: "draft.docx",
        vault: "Research",
      }),
    );
  });

  it("opens the dialog on the vault style where the note names none", async () => {
    const vault = openVault({
      note: {},
      settings: { "citation.references-style": VAULT_STYLE.id },
    });

    const dialog = await vault.openDialog();

    expect(dialog.style.getValue()).toBe(VAULT_STYLE.id);
  });

  it("converts nothing where the user dismissed the dialog", async () => {
    const vault = openVault({ note: {} });

    const dialog = await vault.openDialog();
    dialog.dismiss();
    await vi.waitFor(() => expect(Modal.instances).toHaveLength(1));

    expect(vault.converted()).toBe(false);
  });

  it("opens no dialog for a note whose own style property holds no ID", async () => {
    const vault = openVault({ note: { "zotlit-csl": ["a-list"] } });

    expect(await vault.export()).toEqual({
      kind: "failed",
      problem: { kind: "document-style-invalid" },
    });

    expect(vault.converted()).toBe(false);
    expect(Modal.instances).toHaveLength(0);
  });

  it.each([
    [
      "the note",
      { note: { "zotlit-csl": NOTE_STYLE.id } },
      m.pandoc_export_style_from_note(),
    ],
    [
      "the vault settings",
      {
        note: {},
        settings: { "citation.references-style": VAULT_STYLE.id },
      },
      m.pandoc_export_style_from_vault(),
    ],
    [
      "the Profile",
      {
        note: {
          "zotero-note-key": "1/NOTE1234",
          "zotlit-profile": PROFILE_ID,
        },
        settings: {
          profiles: [
            {
              id: PROFILE_ID,
              label: "Research",
              bindings: { "citation.references-style": NOTE_STYLE.id },
            },
          ],
        },
      },
      m.pandoc_export_style_from_profile({ profile: "Research" }),
    ],
  ] satisfies [string, VaultOptions, string][])(
    "says the style comes from %s",
    async (_source, options, text) => {
      const dialog = await openVault(options).openDialog();

      expect(dialog.styleNote()).toBe(text);
    },
  );

  it("says the note keeps its style where this export picks another", async () => {
    const vault = openVault({ note: { "zotlit-csl": NOTE_STYLE.id } });

    const dialog = await vault.openDialog();
    dialog.style.choose(VAULT_STYLE.id);

    expect(dialog.styleNote()).toBe(
      m.pandoc_export_style_changed({ style: NOTE_STYLE.title }),
    );
  });

  it("names the style the finished export cites with", async () => {
    await using stack = new AsyncDisposableStack();
    const basePath = stack.adopt(
      await mkdtemp(join(tmpdir(), "zotlit-export-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const vault = openVault({
      note: {},
      settings: { "citation.references-style": VAULT_STYLE.id },
      basePath,
    });

    const dialog = await vault.openDialog();
    dialog.confirm();

    expect(await dialog.outcome).toEqual({
      kind: "exported",
      destination: join(basePath, "draft.docx"),
      styleTitle: VAULT_STYLE.title,
    });
    expect(await readFile(join(basePath, "draft.docx"))).toHaveLength(0);
  });

  it("writes the export the palette entry runs", async () => {
    await using stack = new AsyncDisposableStack();
    const basePath = stack.adopt(
      await mkdtemp(join(tmpdir(), "zotlit-export-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const vault = openVault({ note: {}, basePath });

    const dialog = await vault.openDialogFromPalette();
    dialog.confirm();

    await vi.waitFor(async () =>
      expect(await readdir(basePath)).toEqual(["draft.docx"]),
    );
    await vi.waitFor(() =>
      expect(vault.notices.flatMap((notice) => notice.messages)).toContain(
        m.notice_pandoc_export_done({
          file: "draft.docx",
          style: m.settings_citation_references_style_default(),
        }),
      ),
    );
  });

  it("names the Resource Pack and opens its page where no pack is installed", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const vault = openVault({ note: {}, engineInstalled: false });

    expect(await vault.export()).toEqual({
      kind: "engine-missing",
      status: { kind: "pack-absent" },
    });
    vault.runFromPalette();

    const notice = await vi.waitFor(() => {
      const shown = vault.notices
        .flatMap(({ messages }) => messages)
        .find(
          (message): message is DocumentFragment =>
            message instanceof DocumentFragment,
        );
      expect(shown).toBeDefined();
      return shown!;
    });
    expect(Modal.instances).toHaveLength(0);
    expect(notice.textContent).toContain(
      m.notice_pandoc_export_engine_missing(),
    );
    expect(notice.textContent).toContain(
      m.settings_resource_pack_status_absent(),
    );
    const action = controlsOf(
      notice.querySelector<HTMLElement>(".zt-notice-actions")!,
    ).find((control) => control instanceof ButtonComponent)!;
    expect(action.text).toBe(m.settings_resource_pack_open());
    action.click();
    expect(open.mock.calls).toEqual([
      ["obsidian://show-plugin?id=zotlit-resources"],
    ]);
    open.mockRestore();
  });

  it("answers a pack that gives no engine at the first borrow as a missing engine", async () => {
    const vault = openVault({ note: {}, engineStarts: false });

    const dialog = await vault.openDialog();
    dialog.confirm();

    expect(await dialog.outcome).toEqual({
      kind: "engine-missing",
      status: { kind: "pack-damaged" },
    });
  });

  it("stops without a file where the export run is interrupted", async () => {
    exportRun.unload = true;
    await using stack = new AsyncDisposableStack();
    const basePath = stack.adopt(
      await mkdtemp(join(tmpdir(), "zotlit-export-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const vault = openVault({ note: {}, basePath });

    const dialog = await vault.openDialog();
    dialog.confirm();

    expect(await dialog.outcome).toEqual({ kind: "stopped" });
    expect(vault.converted()).toBe(true);
    expect(await readdir(basePath)).toEqual([]);
  });

  it("stops rather than exporting in another style where Zotero lacks the vault style", async () => {
    const vault = openVault({
      note: {},
      settings: { "citation.references-style": MISSING_STYLE_ID },
    });

    const dialog = await vault.openDialog();
    dialog.confirm();

    expect(await dialog.outcome).toEqual({
      kind: "failed",
      problem: { kind: "style-invalid", style: MISSING_STYLE_ID },
    });
    expect(vault.converted()).toBe(false);
  });

  it("names the Profile when its selected style is unavailable", async () => {
    const vault = openVault({
      note: {
        "zotero-note-key": "1/NOTE1234",
        "zotlit-profile": PROFILE_ID,
      },
      settings: {
        profiles: [
          {
            id: PROFILE_ID,
            label: "Research",
            bindings: { "citation.references-style": MISSING_STYLE_ID },
          },
        ],
      },
    });

    const dialog = await vault.openDialog();
    expect(dialog.style.getValue()).toBe(MISSING_STYLE_ID);
    dialog.confirm();

    expect(await dialog.outcome).toEqual({
      kind: "failed",
      problem: { kind: "profile-style-invalid", styleId: MISSING_STYLE_ID },
    });
    expect(vault.converted()).toBe(false);
  });
});
