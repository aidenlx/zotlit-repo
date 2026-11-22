import { citationsPageSlots } from "@zotlit/citations/obsidian/citation-index/settings-page.ts";
import { defineFeature } from "@zotlit/plugin-shell/obsidian/feature.ts";

import { annotationTriggerItems } from "./annotation-suggest/settings-row.ts";

export const queryViews = defineFeature({
  name: "query views",
  settingTab: {
    slots: {
      [citationsPageSlots.suggestions]: () => annotationTriggerItems(),
    },
  },
});
