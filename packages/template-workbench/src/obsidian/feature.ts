// The Template Workbench, as far as it loads on every Obsidian: the Advanced
// page's Profile editing row. The Workbench View, the Local Bridge and the
// Template Data Explorer read Node, so the desktop feature
// (`#desktop/feature.ts`) extends this one with them.
import { defineFeature } from "@zotlit/plugin-shell/obsidian/feature.ts";
import { advancedPageSlots } from "@zotlit/plugin-shell/obsidian/setting-pages/advanced.ts";

import { workbenchPreferenceItems } from "./local-bridge/settings-row.ts";

export const templateWorkbench = defineFeature({
  name: "template workbench",
  settingTab: {
    slots: {
      [advancedPageSlots.general]: (ctx) => workbenchPreferenceItems(ctx),
    },
  },
});
