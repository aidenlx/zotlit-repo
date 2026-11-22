import { Effect, Layer } from "effect";

import { TargetOpener } from "@zotlit/annotations/desktop/attachment-open/open-target.ts";
import { literatureNoteAttachmentsOf } from "@zotlit/annotations/desktop/feature.ts";
import { noteFeatureHandle } from "@zotlit/notes/desktop/feature.ts";
import { interactiveCreation } from "@zotlit/notes/desktop/profile/dialogs.ts";
import { TemplateMigrationPrompt } from "@zotlit/notes/desktop/template/migration.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { bindItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  extendFeature,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import { GraphBuilt } from "@zotlit/plugin-shell/obsidian/graph-built.ts";
import { queryViews } from "@zotlit/query-views/desktop/feature.ts";

import { itemActions } from "./library/item-actions.ts";
import {
  layerShowInLibrary,
  openLibraryView,
  registerLibraryView,
  showInLibrary,
} from "./library/register.ts";
import {
  openWelcomeView,
  registerWelcomeView,
} from "./library/welcome-register.ts";
import { registerQuickSwitch } from "./quick-switch/register.ts";
import { resourcesGroup } from "./welcome/settings-resources.ts";
import { createSetupActions } from "./welcome/setup-actions.ts";

import { libraryView as obsidianLibraryView } from "#obsidian/feature.ts";
import { showInLibraryFileMenu } from "#obsidian/library/show-in-library-actions.ts";
import { layerRelease, Release } from "#obsidian/release/service.ts";

export const libraryView = extendFeature(obsidianLibraryView, {
  services: [
    serviceGroup(
      "ShowInLibrary",
      { provides: [ShowInLibrary] },
      layerShowInLibrary,
    ),
    serviceGroup(
      "Release",
      { provides: [Release] },
      Layer.unwrap(
        Effect.map(PluginHost, (host) =>
          layerRelease({
            version: host.manifest.version,
            openFirstScreen: async () => {
              await openLibraryView(host.app, { pane: "first-screen" });
            },
          }),
        ),
      ),
    ),
    serviceGroup(
      "TemplateMigrationPrompt",
      { provides: [TemplateMigrationPrompt] },
      Layer.unwrap(
        Effect.gen(function* () {
          const host = yield* PluginHost;
          const { whenBuilt } = yield* GraphBuilt;
          return Layer.succeed(TemplateMigrationPrompt, {
            openPrompt: async () => {
              await whenBuilt;
              await openWelcomeView(host.app);
            },
          });
        }),
      ),
    ),
  ],
  settingTab: {
    entries: {
      resources: (ctx) => [resourcesGroup(ctx)],
    },
  },
  handles: ({ read }) => ({
    showInLibrary: read(ShowInLibrary),
    release: read(Release),
  }),
  onload: (ctx) => {
    const { plugin, app, manifest, bridge, read } = ctx;
    const registry = read(ViewRegistry);
    const opener = read(TargetOpener);
    const creation = interactiveCreation(app);
    registerQuickSwitch(plugin, {
      app,
      attachments: literatureNoteAttachmentsOf(ctx),
      lookup: bindItemLookup(bridge, read(ItemLookup)),
      registry,
      creation,
      settings: read(PluginSettings),
      bridge,
      opener,
      showInLibrary: (indexedKey) => showInLibrary(app, indexedKey),
    });
    registerLibraryView(plugin, {
      ...ctx.handlesOf(queryViews).queryViewDeps,
      welcome: {
        registry,
        setupActions: createSetupActions({
          app,
          registry,
          pluginId: manifest.id,
        }),
      },
      items: itemActions({
        creation,
        registry,
        app,
        noteFeature: noteFeatureHandle(ctx),
        opener,
      }),
    });
    registerWelcomeView(plugin, { registry });
    const show = read(ShowInLibrary);
    return {
      fileMenu: {
        "show-in-library": showInLibraryFileMenu((indexedKey) =>
          bridge.runAndForget(show.show(indexedKey)),
        ),
      },
    };
  },
});
