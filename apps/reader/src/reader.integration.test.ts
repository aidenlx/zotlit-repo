// @vitest-environment happy-dom
import { Layer, Logger, References } from "effect";
import { Events, Plugin } from "obsidian";
import type { App, PluginManifest, SettingDefinitionItem } from "obsidian";
import { expect, it } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import {
  layerPluginSettings,
  PluginSettings,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { ShellPluginInstance } from "@zotlit/plugin-shell/obsidian/feature.ts";
import {
  settingDefinitions,
  settingTabContext,
} from "@zotlit/plugin-shell/obsidian/setting-tab/tab.ts";
import type { ReaderApi, RefuseReason } from "@zotlit/reader-api";
import { connectReader, READY_EVENT } from "@zotlit/reader-api";
import { reader } from "@zotlit/reader-feature/obsidian/feature.ts";
import * as m from "@zotlit/reader-messages/messages.ts";

import { host } from "./host.ts";

const manifest: PluginManifest = {
  id: "zotlit-reader",
  name: "ZotLit Reader",
  version: "0.1.0",
  minAppVersion: "1.15.1",
  author: "AidenLx",
  description: "",
};

class ReaderPlugin extends Plugin {
  declare readonly api: ReaderApi | undefined;
  registerView(): void {}
}

function registries() {
  const views: Record<string, string> = { pdf: "pdf" };
  const embeds: Record<string, unknown> = { pdf: "obsidian-embed" };
  return {
    viewRegistry: {
      typeByExtension: views,
      getViewCreatorByType: () => undefined,
      registerExtensions: (extensions: readonly string[], viewType: string) => {
        for (const extension of extensions) views[extension] = viewType;
      },
      unregisterExtensions: (extensions: readonly string[]) => {
        for (const extension of extensions) delete views[extension];
      },
    },
    embedRegistry: {
      embedByExtension: embeds,
      registerExtension: (extension: string, creator: unknown) => {
        embeds[extension] = creator;
      },
      unregisterExtension: (extension: string) => {
        delete embeds[extension];
      },
    },
  };
}

type Registries = ReturnType<typeof registries>;
type MaybeRegistries = {
  readonly [K in keyof Registries]?: Registries[K] | undefined;
};

function readerWorkspace(): App["workspace"] {
  return Object.assign(new Events(), {
    getLeavesOfType: () => [],
  }) as unknown as App["workspace"];
}

async function startReader(options: {
  readonly registries: boolean;
  readonly saved?: Record<string, unknown>;
  readonly workspace?: App["workspace"];
}) {
  const workspace = options.workspace ?? readerWorkspace();
  const app = stubService<App & MaybeRegistries>("App", {
    workspace,
    ...(options.registries
      ? registries()
      : { viewRegistry: undefined, embedRegistry: undefined }),
  });
  const plugin = new ReaderPlugin(app, manifest) as ReaderPlugin &
    ShellPluginInstance;
  const logs: { message: unknown; annotations: Record<string, unknown> }[] = [];
  const writes: Record<string, unknown>[] = [];
  const notifier = testNotifier();
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    Layer.mergeAll(
      notifier.layer,
      Logger.layer([
        Logger.make(({ message, fiber }) => {
          logs.push({
            message,
            annotations: { ...fiber.getRef(References.CurrentLogAnnotations) },
          });
        }),
      ]),
      layerPluginSettings(
        {
          loadData: async () => options.saved ?? null,
          saveData: async (data: Record<string, unknown>) => {
            writes.push(data);
          },
        },
        host.settings,
      ),
    ),
    stack,
  );
  await runtime.context();
  const bridge = effectBridge(runtime);
  plugin.load();
  reader.onload({
    plugin,
    app,
    manifest,
    stack,
    runtime,
    bridge,
    read: (effect) => runtime.runSync(effect),
    handlesOf: () => {
      throw new Error("The reader reads no other feature's handles");
    },
  });
  return {
    app,
    plugin,
    logs,
    notices: notifier.notices,
    writes,
    release: () => bridge.runPromise(runtime.runSync(PluginSettings).release),
    setOpenAllPdfs: (on: boolean) =>
      bridge.runPromise(
        runtime.runSync(PluginSettings).update({ "reader.open-all-pdfs": on }),
      ),
    [Symbol.asyncDispose]: async () => {
      plugin.unload();
      await stack.disposeAsync();
    },
  };
}

it("opens every PDF, embed and hover preview in the reader after a new install", async () => {
  await using started = await startReader({ registries: true });
  expect(started.app.viewRegistry?.typeByExtension.pdf).toBe("zotlit-pdf");
  expect(started.app.embedRegistry?.embedByExtension.pdf).not.toBe(
    "obsidian-embed",
  );
  expect(started.notices).toEqual([]);
});

it('gives PDFs back to Obsidian when "Open all PDFs" is turned off, and takes them again when it is turned on', async () => {
  await using started = await startReader({ registries: true });
  const { viewRegistry, embedRegistry } = started.app;

  await started.setOpenAllPdfs(false);
  await expect.poll(() => viewRegistry?.typeByExtension.pdf).toBe("pdf");
  expect(embedRegistry?.embedByExtension.pdf).toBe("obsidian-embed");

  await started.setOpenAllPdfs(true);
  await expect.poll(() => viewRegistry?.typeByExtension.pdf).toBe("zotlit-pdf");
  expect(embedRegistry?.embedByExtension.pdf).not.toBe("obsidian-embed");
});

it("shows a notice when this version of Obsidian gives the reader no way to open all PDFs", async () => {
  await using started = await startReader({ registries: false });
  await expect
    .poll(() => started.notices.map((notice) => notice.messages[0]))
    .toEqual([m.reader_takeover_unavailable()]);
});

it("saves only the Reader's own keys in its data.json, and keeps PDFs in Obsidian's viewer after a restart with the row off", async () => {
  let saved: Record<string, unknown> | undefined;
  {
    await using started = await startReader({ registries: true });
    await started.setOpenAllPdfs(false);
    await started.release();
    saved = started.writes.at(-1);
  }
  expect(Object.keys(saved ?? {}).sort()).toEqual([
    "__VERSION__",
    "reader.open-all-pdfs",
  ]);
  await using restarted = await startReader({ registries: true, saved });
  expect(restarted.app.viewRegistry?.typeByExtension.pdf).toBe("pdf");
});

function client(major: number) {
  const answers: (
    | { readonly accepted: ReaderApi }
    | { readonly refused: RefuseReason }
    | "absent"
  )[] = [];
  return {
    answers,
    connect: (workspace: App["workspace"]) =>
      connectReader(
        workspace,
        { client: "reader-probe", major, minor: 0 },
        {
          onAccept: (accepted) => answers.push({ accepted }),
          onRefuse: (refused) => answers.push({ refused }),
          onAbsent: () => answers.push("absent"),
        },
      ),
  };
}

it("gives a plugin that asks for version 1 the Reader's API, the same object as plugin.api", async () => {
  await using started = await startReader({ registries: true });
  const probe = client(1);
  probe.connect(started.app.workspace);
  expect(probe.answers).toHaveLength(1);
  const [answer] = probe.answers;
  expect(answer).toHaveProperty("accepted");
  const api = (answer as { readonly accepted: ReaderApi }).accepted;
  expect(api).toBe(started.plugin.api);
  expect(api.api.major).toBe(1);
  expect(api.viewType).toBe("zotlit-pdf");
  expect(api.readerVersion).toBe(manifest.version);
  expect(started.logs).toEqual([]);
});

it("refuses a plugin that asks for version 2, names version 1, and writes one log line", async () => {
  await using started = await startReader({ registries: true });
  const probe = client(2);
  probe.connect(started.app.workspace);
  expect(probe.answers).toEqual([
    { refused: { supported: [1], readerVersion: manifest.version } },
  ]);
  await expect.poll(() => started.logs).toHaveLength(1);
  expect(started.logs[0]!.annotations).toMatchObject({
    client: "reader-probe",
    major: 2,
    supported: [1],
  });
  expect(started.notices).toEqual([]);
});

it("connects a plugin that loaded first when the Reader starts, and says it is ready once", async () => {
  const workspace = readerWorkspace();
  let ready = 0;
  const events: Events = workspace;
  events.on(READY_EVENT, () => {
    ready++;
  });
  const probe = client(1);
  probe.connect(workspace);
  expect(probe.answers).toEqual(["absent"]);
  await using started = await startReader({ registries: true, workspace });
  expect(ready).toBe(1);
  expect(probe.answers).toHaveLength(2);
  expect(probe.answers[1]).toEqual({ accepted: started.plugin.api });
});

it("at unload, tells connected plugins first while the Reader still opens PDFs, then gives PDFs back and answers no later plugin", async () => {
  const workspace = readerWorkspace();
  const seen: (string | undefined)[] = [];
  let typeByExtension: Record<string, string> | undefined;
  {
    await using started = await startReader({ registries: true, workspace });
    typeByExtension = started.app.viewRegistry?.typeByExtension;
    started.plugin.api!.onClose(() => {
      seen.push(typeByExtension?.pdf);
    });
  }
  expect(seen).toEqual(["zotlit-pdf"]);
  expect(typeByExtension?.pdf).toBe("pdf");
  const later = client(1);
  later.connect(workspace);
  expect(later.answers).toEqual(["absent"]);
});

function rows(items: readonly SettingDefinitionItem[]): string[][] {
  return items.flatMap((item) => [
    ...("name" in item && typeof item.name === "string"
      ? [
          [
            item.name,
            "desc" in item && typeof item.desc === "string" ? item.desc : "",
          ],
        ]
      : []),
    ...("type" in item && item.items ? rows(item.items) : []),
  ]);
}

it('shows the Reader page and the "Open all PDFs" row with their descriptions', () => {
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: stubService<SettingTabContext["tab"]>("SettingTab", {}),
    app: stubService<App>("App", {}),
    manifest: stubService<SettingTabContext["manifest"]>("PluginManifest", {
      dir: "plugins/zotlit-reader",
      name: "ZotLit Reader",
    }),
  });
  const tree = settingDefinitions(
    settingTabContext(ctx, ctx, host.features),
    host.features,
    host.settingTab,
  );
  const shown = rows(tree);
  expect(shown).toContainEqual([
    m.reader_settings_page(),
    m.reader_settings_page_desc(),
  ]);
  expect(shown).toContainEqual([
    m.reader_settings_open_all_pdfs_name(),
    m.reader_settings_open_all_pdfs_desc(),
  ]);
});
