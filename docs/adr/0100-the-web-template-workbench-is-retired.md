---
status: accepted
---

# The web Template Workbench is retired

Supersedes [ADR 0033](0033-web-workbench-is-public-and-standalone.md), [ADR 0042](0042-a-workbench-connection-starts-in-obsidian.md) and [ADR 0046](0046-customize-is-a-chooser-between-the-web-workbench-and-the-profile-editor.md). Amends [ADR 0032](0032-web-workbench-edits-one-source-document.md).

## Context

One Workbench UI had two hosts: the web Template Workbench at `/workbench` on the docs site, and the Template Workbench View in Obsidian. The second host cost more than its page:

- a Local Bridge on the Local Server, with Connection codes, a session credential, its own wire schemas and client, and a mock of it in the Fixture;
- a Customize chooser between the two hosts, with a launch sheet and a device preference;
- a `WEB_WORKBENCH_ENABLED` build flag, which every Vitest config of the plugin defined and which the setting tab, the commands and the `obsidian://zotlit/import-profile` link read;
- a React and a Preact run of every UI suite of `@zotlit/workbench`;
- render paths for a dependency bundle and a Resolved CSL Style that only the Local Bridge supplied;
- a message contract (`WorkbenchMessages`) that two message runtimes compile.

The flag was off in every release ([ADR 0046](0046-customize-is-a-chooser-between-the-web-workbench-and-the-profile-editor.md)), so no reader used the web page through Obsidian. The Template Workbench View covers the workflow: it opens every Template Document kind, runs Eta and JavaScript fields, saves to the vault, and shows the Preview and the Fields Panel beside the editor.

## Decision

- **The web host is gone.** The `/workbench` route, its editor bundle, its design spec and the `zotlit-design/workbench-chrome` lint rule are removed from `apps/docs`, with the route's sitemap, prerender, locale and OG card entries.
- **The Local Bridge is gone.** Its client and schemas (`@zotlit/workbench/bridge`), its server in `@zotlit/template-workbench`, the `server.workbench` setting and its row, the Local Server's route-mount seam and its hosted-services slot, the Fixture's mock bridge (`pnpm fixture bridge`), and the `WEB_WORKBENCH_ENABLED` build flag are removed. The `obsidian://zotlit/import-profile` link, the web page's clipboard handoff, goes with them; no release handled it.
- **Customize opens the Template Workbench View.** Every Customize entry point (the Profiles page, the Default Profile row, a duplicated Profile) opens the Profile in the View directly. There is no chooser and no device preference; a stored `zotlit-profile-customization` value is no longer read.
- **The Workbench core stays shared within the plugin.** `@zotlit/workbench` keeps the document controller, the language, rendering and the headless UI, now with one host. Its UI suites run once, under Preact, as Obsidian runs them. The editing model of [ADR 0032](0032-web-workbench-edits-one-source-document.md) and the Item Snapshot of [ADR 0043](0043-an-item-snapshot-carries-only-allow-listed-fields.md) stay in force for the View.
- **A later step folds `@zotlit/workbench` into `@zotlit/template-workbench`.** Before it, parts of the core move down to the packages that own them. Until then the core keeps the `WorkbenchMessages` contract, and two parts its one host does not call: the document controller's `web` runtime, and `renderProfile`, which only the core's own tests call.

## Consequences

- A reader edits templates in Obsidian only. The docs describe the Template Workbench View and no web page.
- The plugin's settings drop `server.workbench`; a `data.json` that still holds it loads, and the key is dropped as an unknown key.
- The Local Server hosts Live Update alone; its toggle and its port rows stay.
- A future web surface starts from a new decision, not from this code.
