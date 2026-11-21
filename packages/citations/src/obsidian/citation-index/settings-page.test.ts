// @vitest-environment happy-dom
import { Context, Effect } from "effect";
import { describe, expect, it } from "vitest";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { citationsPageItems } from "./settings-page.ts";

import { testSettingTab } from "#__fixtures__/setting-tab.ts";
import { defaults } from "#__fixtures__/settings.ts";
import { PandocEngine } from "#obsidian/pandoc/service.ts";

/** The tab over `settings` and a Pandoc engine that is not installed. */
const pandocTab = (settings: Settings) =>
  testSettingTab(
    Context.make(
      PandocEngine,
      stubService<PandocEngine["Service"]>("PandocEngine", {
        current: Effect.succeed({ kind: "pack-absent" }),
      }),
    ).pipe(
      Context.add(
        PluginSettings,
        stubService<PluginSettings["Service"]>("PluginSettings", {
          current: Effect.succeed(settings),
        }),
      ),
    ),
  ).tab;

/**
 * The Citations page context over `settings`, with the Graph plugin off and
 * no rows from the features that fill the page's slots.
 */
const citationsContext = (settings: Settings) =>
  stubService<SettingTabContext>("SettingTabContext", {
    tab: pandocTab(settings),
    app: stubService<SettingTabContext["app"]>("App", {
      internalPlugins: { getEnabledPluginById: () => null },
    }),
    manifest: stubService<SettingTabContext["manifest"]>("PluginManifest", {
      version: "test",
    }),
    slot: () => [],
  });

describe("hover settings", () => {
  /** The Hover group's rows for a given saved hover action. */
  const hoverRows = (settings: Settings) => {
    const ctx = citationsContext(settings);
    const group = citationsPageItems(ctx).find(
      (item) =>
        "type" in item &&
        item.type === "group" &&
        item.heading === m.settings_citation_hover_heading(),
    );
    if (!group || !("items" in group) || !group.items)
      throw new Error("hover group missing");
    return group.items;
  };

  it("shows the Require Mod page under the Citation popover alone", () => {
    for (const action of ["popover", "off", "page-preview"] as const) {
      const page = hoverRows({
        ...defaults,
        "citation.hover-action": action,
      })[1];
      const predicate = page && "visible" in page ? page.visible : undefined;
      const visible = typeof predicate === "function" ? predicate() : predicate;
      expect(visible).toBe(action === "popover");
    }
  });
});

describe("citation source settings", () => {
  it("offers each citation syntax as a source", () => {
    const ctx = citationsContext(defaults);
    const sourceGroup = citationsPageItems(ctx).find(
      (item) =>
        "type" in item &&
        item.type === "group" &&
        item.heading === m.settings_citation_sources_heading(),
    );
    if (!sourceGroup || !("items" in sourceGroup) || !sourceGroup.items)
      throw new Error("citation source group missing");

    expect(sourceGroup.items).toMatchObject([
      { id: "settings_citation_pandoc_citations" },
      { id: "settings_citation_wikilink_citations" },
      { id: "settings_citation_annotation_citations" },
    ]);
  });
});
