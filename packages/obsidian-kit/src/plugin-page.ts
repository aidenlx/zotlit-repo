export const showPluginPage = (id: string): string =>
  `obsidian://show-plugin?id=${encodeURIComponent(id)}`;
