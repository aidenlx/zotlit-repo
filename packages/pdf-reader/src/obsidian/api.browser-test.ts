import type { PdfReader } from "#/core/index.ts";
import type {
  EmbedComponent,
  EmbedCreator,
  EmbedRegistry,
  ViewRegistry,
} from "#/obsidian/private.ts";
import type { PdfReaderRegistration } from "#/obsidian/register.ts";
import type { App, PluginManifest, TFile, ViewCreator } from "obsidian";
import { Plugin, TFile as StandInFile } from "obsidian";

import { setMockPlatform } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type { ReaderExtension, ReaderHostContext } from "@zotlit/reader-api";

import { registerPdfReader } from "#/obsidian/register.ts";
import { fixturePdf } from "#test/fixtures.ts";
import { bytesSource } from "#test/pdf.ts";
import { installStyles, testEngine, within } from "#test/reader.ts";

const NAVIGATION = fixturePdf("pdf-reader/navigation.pdf");

interface Attached {
  readonly id: string;
  readonly subpath: string | null;
  readonly restored: boolean;
  readonly kind: string;
}

export interface ApiReport {
  readonly identity: {
    readonly api: { readonly major: number; readonly minor: number };
    readonly readerVersion: string;
    readonly pdfjsBuild: string;
    readonly viewType: string;
    readonly readerOfNull: boolean;
  };
  readonly attached: readonly Attached[];
  readonly lateNodes: { readonly before: number; readonly after: number };
  readonly lateDisposed: number;
  readonly loaded: { readonly pages: number };
  readonly rejected: { readonly reason: unknown };
  readonly unload: readonly string[];
  readonly reports: readonly string[];
}

class TrialPlugin extends Plugin {
  readonly views = new Map<string, ViewCreator>();

  registerView(type: string, creator: ViewCreator): void {
    this.views.set(type, creator);
  }
}

function trialApp(): App {
  const views: ViewRegistry & {
    typeByExtension: Record<string, string>;
  } = {
    typeByExtension: { pdf: "pdf" },
    registerExtensions(extensions, viewType) {
      for (const extension of extensions)
        this.typeByExtension[extension] = viewType;
    },
    unregisterExtensions(extensions) {
      for (const extension of extensions)
        delete this.typeByExtension[extension];
    },
  };
  const embeds: EmbedRegistry & {
    embedByExtension: Record<string, EmbedCreator>;
  } = {
    embedByExtension: {},
    registerExtension(extension, creator) {
      this.embedByExtension[extension] = creator;
    },
    unregisterExtension(extension) {
      delete this.embedByExtension[extension];
    },
  };
  const stored = new Map<string, unknown>();
  const app = {
    viewRegistry: views,
    embedRegistry: embeds,
    workspace: {
      activeLeaf: null,
      getLeavesOfType: () => [],
      on: () => ({}),
      offref: () => {},
    },
    vault: {
      readBinary: async () => NAVIGATION.slice().buffer,
      on: () => ({}),
      offref: () => {},
    },
    fileManager: { generateMarkdownLink: () => "" },
    loadLocalStorage: (key: string) => stored.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      stored.set(key, value);
    },
  };
  return app as unknown as App;
}

function trialFile(): TFile {
  const file = new StandInFile();
  file.path = "papers/navigation.pdf";
  file.name = "navigation.pdf";
  file.basename = "navigation";
  file.extension = "pdf";
  return file;
}

async function embed(
  app: App,
  file: TFile,
  subpath: string,
): Promise<{ readonly reader: PdfReader; readonly containerEl: HTMLElement }> {
  const containerEl = document.createElement("div");
  containerEl.style.cssText =
    "position: relative; width: 600px; height: 400px;";
  document.body.append(containerEl);
  const creator = (
    app as unknown as {
      embedRegistry: { embedByExtension: Record<string, EmbedCreator> };
    }
  ).embedRegistry.embedByExtension.pdf!;
  const component = creator(
    { app, containerEl, linktext: file.path, sourcePath: "", depth: 0 },
    file,
    subpath,
  )!;
  component.load();
  await component.loadFile();
  const { reader } = component as EmbedComponent & {
    readonly reader: PdfReader | null;
  };
  if (!reader) throw new Error("The embed mounted no reader");
  return { reader, containerEl };
}

function recorder(
  id: string,
  attached: Attached[],
  options: {
    readonly onDispose?: (host: ReaderHostContext) => void;
    readonly slot?: boolean;
  } = {},
): ReaderExtension {
  return {
    id,
    kinds: ["embed"],
    attach: ({ reader, host, subpath }) => {
      attached.push({
        id,
        subpath: subpath?.raw ?? null,
        restored: host.restored,
        kind: host.kind,
      });
      if (options.slot) {
        const mark = document.createElement("span");
        mark.dataset.probe = id;
        reader.slot("toolbar-start").append(mark);
      }
      return {
        [Symbol.dispose]: () => {
          options.onDispose?.(host);
        },
      };
    },
  };
}

export async function run(): Promise<ApiReport> {
  setMockPlatform({ isMacOS: false, isDesktopApp: true });
  installStyles();
  const app = trialApp();
  const manifest = { id: "trial", version: "9.9.9-trial" } as PluginManifest;
  const plugin = new TrialPlugin(app, manifest);
  plugin.load();
  const attached: Attached[] = [];
  const unload: string[] = [];
  const reports: string[] = [];
  const registration: PdfReaderRegistration = registerPdfReader(plugin, {
    viewType: "trial-pdf",
    engine: testEngine(),
    report: (_error, where) => {
      reports.push(where.phase);
    },
    extensions: [
      {
        id: "option",
        kinds: ["embed"],
        attach: ({ host, subpath }) => {
          attached.push({
            id: "option",
            subpath: subpath?.raw ?? null,
            restored: host.restored,
            kind: host.kind,
          });
          return {
            [Symbol.dispose]: () => {
              unload.push(`dispose:option:${host.unloading()}`);
            },
          };
        },
      },
    ],
  });
  const { api } = registration;
  registration.setTakeover(true);
  const file = trialFile();

  const removeEarly = api.addExtension(
    recorder("early", attached, {
      onDispose: (host) => unload.push(`dispose:early:${host.unloading()}`),
    }),
  );
  const first = await embed(app, file, "#page=2");
  await within("first ready", first.reader.whenReady());

  let lateDisposed = 0;
  const removeLate = api.addExtension(
    recorder("late", attached, {
      slot: true,
      onDispose: () => {
        lateDisposed++;
      },
    }),
  );
  const second = await embed(app, file, "");
  await within("second ready", second.reader.whenReady());
  const lateNodes = () =>
    document.querySelectorAll(
      '[data-zpr-slot="toolbar-start"] [data-probe="late"]',
    ).length;
  const before = lateNodes();
  removeLate();
  removeLate();
  const after = lateNodes();

  await using document_ = await api.loadDocument(
    bytesSource("ok.pdf", NAVIGATION),
  );
  const loaded = { pages: document_.proxy.numPages };
  const rejected = await api
    .loadDocument(bytesSource("bad.pdf", new TextEncoder().encode("not a pdf")))
    .then(
      () => ({ reason: "resolved" }),
      (error: unknown) => ({ reason: (error as { reason?: unknown }).reason }),
    );

  api.onClose(() => {
    unload.push("close:throws");
    throw new Error("close listener fails");
  });
  api.onClose(() => {
    unload.push("close");
    removeEarly();
  });
  const identity = {
    api: api.api,
    readerVersion: api.readerVersion,
    pdfjsBuild: api.pdfjsBuild,
    viewType: api.viewType,
    readerOfNull: api.readerOf(null) === null,
  };
  plugin.unload();
  first.containerEl.remove();
  second.containerEl.remove();
  return {
    identity,
    attached,
    lateNodes: { before, after },
    lateDisposed,
    loaded,
    rejected,
    unload,
    reports,
  };
}
