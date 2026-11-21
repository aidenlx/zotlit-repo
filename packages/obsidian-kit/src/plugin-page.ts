// The page of a plugin in Obsidian's community plugin browser.

/** The `obsidian://` link that opens the page of the plugin `id`. */
export const showPluginPage = (id: string): string =>
  `obsidian://show-plugin?id=${encodeURIComponent(id)}`;
