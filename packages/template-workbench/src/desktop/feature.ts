import { Effect } from "effect";

import { notes } from "@zotlit/notes/desktop/feature.ts";
import { literatureNoteSlots } from "@zotlit/notes/obsidian/profile/main-page-rows.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import { revealSetting } from "@zotlit/obsidian-kit/open-settings.ts";
import { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
// The Template Workbench on the desktop: the Obsidian feature
// (`#obsidian/feature.ts`) with Customize, the notes' launch port it fills,
// the Template Workbench View, the Template Data Explorer, the Profiles page
// and the workbench links.
import { bindItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  extendFeature,
  registration,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import type { FeatureContext } from "@zotlit/plugin-shell/obsidian/feature.ts";

import { layerTemplateWorkbenchCli } from "./cli/register.ts";
import {
  explorerFileMenu,
  registerTemplateDataExplorer,
} from "./data-explorer/register.ts";
import type { WorkbenchActionServices } from "./editor/actions.ts";
import {
  defaultDocumentItem,
  profilesPage,
} from "./profile-settings/profiles-page.ts";
import { workbenchLinks } from "./protocol/handlers.ts";
import { Customize, layerCustomize } from "./view/customize.ts";
import {
  layerTemplateWorkbenchLauncher,
  openTemplateWorkbench,
} from "./view/open.ts";
import {
  registerTemplateWorkbenchView,
  templateWorkbenchFileMenu,
} from "./view/register.ts";

import { templateWorkbench as obsidianTemplateWorkbench } from "#obsidian/feature.ts";

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
    // The Citation Template's actions and the Profile dialogs open a
    // document in the Template Workbench View through this port.
    serviceGroup(
      "TemplateWorkbenchLauncher",
      { provides: [TemplateWorkbenchLauncher], requires: [Profile] },
      layerTemplateWorkbenchLauncher,
    ),
    // Customize opens a Profile in the Template Workbench View.
    serviceGroup(
      "Customize",
      { provides: [Customize], requires: [Profile] },
      layerCustomize({
        openNative: ({ item, originatingNote }, target) =>
          openTemplateWorkbench(target, {
            ...(item ? { itemIndexedKey: item.key } : {}),
            originatingNote,
            explainUnsupported: false,
            customize: true,
          }),
      }),
    ),
  ],
  registrations: [
    registration("TemplateWorkbenchCli", layerTemplateWorkbenchCli),
  ],
  protocol: workbenchLinks(),
  settingTab: {
    entries: { profiles: (ctx) => [profilesPage(ctx)] },
    slots: {
      [literatureNoteSlots.document]: (ctx) => [defaultDocumentItem(ctx)],
    },
  },
  handles: (ctx) => ({
    workbenchActionContext: workbenchActionsOf(ctx).context,
  }),
  onload: (ctx) => {
    const { plugin, app, manifest, bridge, read } = ctx;
    const { defaultProfile } = ctx.handlesOf(notes);
    const registry = read(ViewRegistry);
    const itemLookup = bindItemLookup(bridge, read(ItemLookup));
    const settings = read(PluginSettings);
    const actions = workbenchActionsOf(ctx);
    const deps = {
      registry,
      ...actions,
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
