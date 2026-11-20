// @vitest-environment happy-dom
import { Context, Effect, Stream } from "effect";
import type {
  App,
  SettingDefinitionItem,
  SettingTab,
  SettingsModal,
} from "obsidian";
import { expect, it, vi } from "vitest";

import { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import { revealSetting } from "@zotlit/obsidian-kit/open-settings.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { ChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  settingDefinitions,
  settingTabContext,
} from "@zotlit/plugin-shell/obsidian/setting-tab/tab.ts";
import { LocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";

import { features } from "@/features.ts";
import { host } from "@/host.ts";
import { defaults } from "@/services/settings/schema.ts";

import { profileRowServices, testSettingTab } from "./__fixtures__.ts";

vi.mock(
  "@zotlit/template-workbench/desktop/view/open.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@zotlit/template-workbench/desktop/view/open.ts")
    >()),
    openTemplateWorkbench: vi.fn(() => Effect.void),
  }),
);

function ctx(): SettingTabContext {
  return stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(
      profileRowServices().pipe(
        Context.add(
          LibraryScope,
          LibraryScope.of({
            state: Effect.die("unread"),
            changes: Stream.empty,
            current: Effect.succeed(null),
            effective: Effect.succeed({ mode: "all" }),
            invalid: Effect.succeed(false),
            libraries: Effect.succeed([]),
            libraryRows: Effect.succeed(null),
            resolveLibraries: () => Effect.die("unread"),
          }),
        ),
        Context.add(
          PandocEngine,
          stubService<PandocEngine["Service"]>("PandocEngine", {
            getStatus: Effect.succeed({ kind: "absent" }),
            changes: Stream.empty,
          }),
        ),
        Context.add(
          LanguagePack,
          stubService<LanguagePack["Service"]>("LanguagePack", {
            situation: Effect.succeed({ kind: "unavailable" }),
            plugin: "ZotLit",
            endonym: "English",
          }),
        ),
        Context.add(
          PluginSettings,
          stubService<PluginSettings["Service"]>("PluginSettings", {
            current: Effect.succeed(defaults),
            changes: Stream.empty,
          }),
        ),
        Context.add(
          LocalServer,
          stubService<LocalServer["Service"]>("LocalServer", {
            effectivePort: Effect.succeed(null),
            effectivePortChanges: Stream.empty,
          }),
        ),
        Context.add(
          LocalBridge,
          stubService<LocalBridge["Service"]>("LocalBridge", {
            connection: Effect.succeed(null),
          }),
        ),
        Context.add(
          AttachmentImport,
          stubService<AttachmentImport["Service"]>("AttachmentImport", {
            approvedFolders: Effect.succeed([]),
          }),
        ),
        Context.add(
          ChineseSegmenter,
          stubService<ChineseSegmenter["Service"]>("ChineseSegmenter", {
            getStatus: Effect.succeed({ kind: "absent" }),
            changes: Stream.empty,
          }),
        ),
      ),
    ).tab,
    webWorkbenchEnabled: true,
    app: stubService<SettingTabContext["app"]>("App", {
      vault: stubService<SettingTabContext["app"]["vault"]>("Vault", {
        getFileByPath: () => null,
        adapter: stubService<SettingTabContext["app"]["vault"]["adapter"]>(
          "DataAdapter",
          {},
        ),
      }),
      internalPlugins: stubService<SettingTabContext["app"]["internalPlugins"]>(
        "InternalPlugins",
        { getEnabledPluginById: () => null },
      ),
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    }),
    manifest: stubService<SettingTabContext["manifest"]>("PluginManifest", {
      version: "0.0.0",
      dir: "plugins/zotlit",
    }),
  });
}

/** Walk the definition tree, asserting ids unique among each sibling array. */
function check(label: string, items: readonly SettingDefinitionItem[]): void {
  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    const id = (item as { id?: string }).id;
    expect(id, `${label}: item ${index} missing id`).toBeTruthy();
    const prior = seen.get(id!);
    expect(
      prior,
      `${label}: duplicate id "${id}" at ${prior} and ${index}`,
    ).toBeUndefined();
    seen.set(id!, index);
    visited += 1;
  });

  for (const item of items) {
    if (!("type" in item)) continue;
    const group = item;
    if (group.items) {
      check(`${label} > ${group.type}:${item.id}`, group.items);
    }
  }
}

/** The tab's definitions, as `getSettingDefinitions()` hands them out. */
function realTree(c: SettingTabContext): SettingDefinitionItem[] {
  return settingDefinitions(
    settingTabContext(c, c, features),
    features,
    host.settingTab,
  );
}

let visited = 0;

it("every setting definition carries an id unique among its siblings", () => {
  check("root", realTree(ctx()));
  // Guard against a vacuous pass: the walk must reach the real tree.
  expect(visited).toBeGreaterThan(100);
});

/** Each item's id, indented under the page or group that holds it. */
function outline(items: readonly SettingDefinitionItem[], depth = 0): string[] {
  return items.flatMap((item) => [
    `${"  ".repeat(depth)}${(item as { id?: string }).id}`,
    ...("type" in item && item.items ? outline(item.items, depth + 1) : []),
  ]);
}

// The slots of each page take rows from several features: the outline holds
// the order the tab shows them in, page by page.
it("places every page and row of the composed tab in its order", () => {
  expect(outline(realTree(ctx())).join("\n")).toMatchSnapshot();
});

const TAB_ID = "zotlit";

/**
 * Every row a `revealSetting` call names, with the call site that names it.
 * A renamed definition id breaks the link in silence, so the ids meet the real
 * tree here.
 */
const DEEP_LINKED_ROWS = [
  ["settings_zotero_editing", "services/plugin-runtime.ts"],
  ["settings_citation_references_style", "zt-main.ts, views/references"],
  ["settings_library_scope", "zt-main.ts"],
  ["settings_citation_engine", "views/references/register.ts"],
] as const;

it.each(DEEP_LINKED_ROWS)(
  "the deep link to %s reaches a row the tab renders (%s)",
  (settingId) => {
    const tab = stubService<SettingTab>("SettingTab", {
      id: TAB_ID,
      settingItems: realTree(ctx()),
    });
    const setting = {
      open: vi.fn(),
      openTabById: vi.fn(() => tab),
      navigateToSearchResult: vi.fn(),
      scrollToDefinition: vi.fn(),
    };

    const app = stubService<App>("App", {
      setting: stubService<SettingsModal>("SettingsModal", setting),
    });
    revealSetting(app, TAB_ID, settingId);

    expect(setting.scrollToDefinition).toHaveBeenCalledOnce();
    expect(setting.scrollToDefinition.mock.calls[0]![1]).toMatchObject({
      id: settingId,
    });
  },
);
