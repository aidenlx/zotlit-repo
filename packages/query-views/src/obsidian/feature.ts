// ZotLit Query in Obsidian, as far as it loads on every Obsidian: the
// Citations page's Annotation trigger row. The Item Query adapter, the Query
// View, the Annotation View and the Annotation Suggester read Node, so the
// desktop feature (`#desktop/feature.ts`) extends this one with them.
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
