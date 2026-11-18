# @zotlit/obsidian-desktop

The desktop-only part of the plugin's base: code that needs `node:*` or `electron`, used by more than one unit of the app (the Electron `require`, reflinks, the Markdown link helper, temporary-file sweeps, profile revisions, the Zotero HTTP client over Node `http`). It is a package and not a folder of the app because the desktop plugin and the Reader plugin both need it, and a mobile host must be able to leave it out.

It imports `@zotlit/plugin-kernel`, and may import `@zotlit/obsidian-kit`. The package exports its TypeScript source as `@zotlit/obsidian-desktop/<file>.ts`.
