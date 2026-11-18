import { Effect, FileSystem, Layer, Stream } from "effect";

import { notes } from "@zotlit/notes/desktop/feature.ts";
import { literatureNoteSlots } from "@zotlit/notes/obsidian/profile/main-page-rows.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import { revealSetting } from "@zotlit/obsidian-kit/open-settings.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { WEB_WORKBENCH_ENABLED } from "@zotlit/plugin-kernel/constants.ts";
// The Template Workbench on the desktop: the Obsidian feature
// (`#obsidian/feature.ts`) with the Local Bridge and Customize, the notes'
// launch port it fills, the Template Workbench View, the Template Data
// Explorer, the Profiles page and the workbench links.
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { bindItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  extendFeature,
  registration,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import type { FeatureContext } from "@zotlit/plugin-shell/obsidian/feature.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { layerTemplateWorkbenchCli } from "./cli/register.ts";
import {
  explorerFileMenu,
  registerTemplateDataExplorer,
} from "./data-explorer/register.ts";
import type { WorkbenchActionServices } from "./editor/actions.ts";
import { Customize, layerCustomize } from "./local-bridge/customize.ts";
import { bindLocalBridge } from "./local-bridge/handle.ts";
import { createLaunchSheet } from "./local-bridge/launch-sheet.ts";
import { registerWorkbenchSavedNotice } from "./local-bridge/notices.ts";
import { layerLocalBridge, LocalBridge } from "./local-bridge/service.ts";
import { workbenchServerItems } from "./local-bridge/settings-rows.ts";
import {
  defaultDocumentItem,
  profilesPage,
} from "./profile-settings/profiles-page.ts";
import { workbenchLinks } from "./protocol/handlers.ts";
import {
  layerTemplateWorkbenchLauncher,
  openTemplateWorkbench,
} from "./view/open.ts";
import {
  registerTemplateWorkbenchView,
  templateWorkbenchFileMenu,
} from "./view/register.ts";

import { templateWorkbench as obsidianTemplateWorkbench } from "#obsidian/feature.ts";
import {
  profileCustomization,
  saveProfileCustomization,
} from "#obsidian/local-bridge/preferences.ts";

/** What the Template Workbench's actions read: the bridge and the graph's services. */
export const workbenchActionsOf = ({
  bridge,
  read,
}: Pick<FeatureContext, "bridge" | "read">) => ({
  bridge,
  context: read(Effect.context<WorkbenchActionServices>()),
});

export const templateWorkbench = extendFeature(obsidianTemplateWorkbench, {
  services: [
    serviceGroup(
      "LocalBridge",
      {
        provides: [LocalBridge],
        requires: [
          FileSystem.FileSystem,
          LocalServer,
          NoteIndex,
          Profile,
          Template,
          ZoteroPref,
          ZoteroReads,
        ],
      },
      Layer.unwrap(
        Effect.map(PluginHost, (host) =>
          layerLocalBridge({
            webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
            pluginVersion: host.manifest.version,
          }),
        ),
      ),
    ),
    // The Citation Template's actions and the Profile dialogs open a
    // document in the Template Workbench View through this port.
    serviceGroup(
      "TemplateWorkbenchLauncher",
      { provides: [TemplateWorkbenchLauncher], requires: [Profile] },
      layerTemplateWorkbenchLauncher,
    ),
    // Customize launches over the Local Bridge.
    serviceGroup(
      "Customize",
      {
        provides: [Customize],
        requires: [LocalBridge, LocalServer, Profile, Template],
      },
      Layer.unwrap(
        Effect.map(PluginHost, (host) =>
          layerCustomize({
            webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
            pluginVersion: host.manifest.version,
            confirmLaunch: createLaunchSheet(host.app),
            openExternal: (url) => window.open(url),
            preference: () => profileCustomization(host.app),
            rememberPreference: (value) =>
              saveProfileCustomization(host.app, value),
            openNative: ({ item, originatingNote }, target) =>
              openTemplateWorkbench(target, {
                ...(item ? { itemIndexedKey: item.key } : {}),
                originatingNote,
                explainUnsupported: false,
                customize: true,
              }),
          }),
        ),
      ),
    ),
  ],
  registrations: [
    registration("TemplateWorkbenchCli", layerTemplateWorkbenchCli),
  ],
  protocol: workbenchLinks({ webWorkbenchEnabled: WEB_WORKBENCH_ENABLED }),
  settingTab: {
    entries: { profiles: (ctx) => [profilesPage(ctx)] },
    slots: {
      [literatureNoteSlots.document]: (ctx) => [defaultDocumentItem(ctx)],
      "local-server.services": (ctx) => workbenchServerItems(ctx),
    },
    rebuild: [
      // The Workbench Connection row stands only while a connection does.
      Effect.map(LocalBridge, (bridge) => Stream.drop(bridge.changes, 1)),
    ],
  },
  handles: (ctx) => ({
    localBridge: bindLocalBridge(ctx.bridge, ctx.read(LocalBridge)),
    workbenchActionContext: workbenchActionsOf(ctx).context,
  }),
  onload: (ctx) => {
    const { plugin, app, manifest, bridge, read, stack } = ctx;
    const { noteActions, defaultProfile } = ctx.handlesOf(notes);
    stack.defer(
      registerWorkbenchSavedNotice({
        localBridge: bindLocalBridge(bridge, read(LocalBridge)),
        updateAll: () => noteActions.updateAll({ create: false }),
      }),
    );
    const registry = read(ViewRegistry);
    const itemLookup = bindItemLookup(bridge, read(ItemLookup));
    const settings = read(PluginSettings);
    const actions = workbenchActionsOf(ctx);
    const deps = {
      registry,
      ...actions,
      webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
      defaultProfile,
      itemLookup,
      settings,
      nativePreview: {
        app,
        registry,
        openCitationEngineSettings: () => {
          revealSetting(app, manifest.id, "settings_citation_engine");
        },
      },
    };
    registerTemplateWorkbenchView(plugin, deps);
    registerTemplateDataExplorer(plugin, {
      ...actions,
      app,
      registry,
      itemLookup,
      settings,
    });
    return {
      fileMenu: {
        "template-workbench": templateWorkbenchFileMenu(app, deps),
        explorer: explorerFileMenu(actions),
      },
    };
  },
});
