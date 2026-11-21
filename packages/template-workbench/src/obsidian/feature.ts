// The Template Workbench, as far as it loads on every Obsidian. The Workbench
// View, Customize and the Template Data Explorer read Node, so the desktop
// feature (`#desktop/feature.ts`) extends this one with them.
import { defineFeature } from "@zotlit/plugin-shell/obsidian/feature.ts";

export const templateWorkbench = defineFeature({
  name: "template workbench",
});
