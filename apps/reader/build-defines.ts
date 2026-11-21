import { PUBLISHED_PLUGINS } from "@zotlit/scripts/shell/plugins";

import packageJson from "./package.json" with { type: "json" };

export const buildDefines = (dev: boolean): Record<string, string> => ({
  __DEV__: JSON.stringify(dev),
  __PLUGIN_ID__: JSON.stringify(packageJson.obsidian.id),
  __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
  __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(false),
  __PLUGIN_REPOSITORY__: JSON.stringify(PUBLISHED_PLUGINS.reader.repository),
});
