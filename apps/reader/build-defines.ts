import { PUBLISHED_PLUGINS } from "@zotlit/scripts/shell/plugins";

export const buildDefines = (dev: boolean): Record<string, string> => ({
  __DEV__: JSON.stringify(dev),
  __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
  __WEB_WORKBENCH_ENABLED__: JSON.stringify(false),
  __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(false),
  __PLUGIN_REPOSITORY__: JSON.stringify(PUBLISHED_PLUGINS.reader.repository),
});
