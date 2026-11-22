import { Effect, Stream } from "effect";

import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  defineFeature,
  registration,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import { advancedPageSlots } from "@zotlit/plugin-shell/obsidian/setting-pages/advanced.ts";

import { layerShowInLibraryActions } from "./library/show-in-library-actions.ts";
import { showInLibraryLink } from "./library/show-in-library-link.ts";
import { layerReleaseActions } from "./release/actions.ts";
import { updateNoticesItem } from "./release/settings-row.ts";

import { librarySettings } from "#core/library/settings.ts";
import { releaseSettings } from "#core/release/settings.ts";
import { welcomeSettings } from "#core/welcome/settings.ts";

export const libraryView = defineFeature({
  name: "library view",
  settings: [librarySettings, welcomeSettings, releaseSettings],
  registrations: [
    registration("ReleaseActions", layerReleaseActions),
    registration("ShowInLibraryActions", layerShowInLibraryActions),
  ],
  protocol: [showInLibraryLink],
  settingTab: {
    slots: { [advancedPageSlots.general]: () => [updateNoticesItem()] },
    rebuild: [
      Effect.map(PluginSettings, (settings) =>
        settings.changes.pipe(
          Stream.map((current) => current["release.migration-pending"]),
          Stream.changes,
          Stream.drop(1),
        ),
      ),
    ],
  },
});
