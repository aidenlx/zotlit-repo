// @vitest-environment happy-dom
import { it as effectIt } from "@effect/vitest";
import { Context, Effect } from "effect";
import type { SettingDefinitionItem } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { renderRow } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type {
  DropdownComponent,
  TextComponent,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { eventually } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { highlightEmoji } from "@zotlit/plugin-kernel/highlight-mapping.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import {
  PluginSettings,
  SettingsMutationError,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { highlightMappingItems } from "./settings-page.ts";

import { scopedSettingTab, testSettingTab } from "#__fixtures__/setting-tab.ts";
import { defaults } from "#__fixtures__/settings.ts";

function setup() {
  let current: Settings = { ...defaults };
  const update = (
    patch: Partial<Settings> | ((settings: Settings) => Partial<Settings>),
  ) => {
    current = {
      ...current,
      ...(typeof patch === "function" ? patch(current) : patch),
    };
  };
  const settings = stubService<PluginSettings["Service"]>("PluginSettings", {
    current: Effect.sync(() => current),
    update: (patch) =>
      Effect.sync(() => {
        const next = typeof patch === "function" ? patch(current) : patch;
        return Object.assign(current, next);
      }),
  });
  const rebuild = vi.fn<() => void>();
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(Context.make(PluginSettings, settings), {
      update: rebuild,
    }).tab,
  });
  const rows = highlightMappingItems(ctx);
  const row = (name: string) => {
    const item = rows.find((entry) => "name" in entry && entry.name === name);
    if (!item) throw new Error(`Mapping row missing: ${name}`);
    return item;
  };
  return { ctx, row, update, settings, rebuild };
}

function visible(item: SettingDefinitionItem) {
  return typeof item.visible === "function"
    ? item.visible()
    : (item.visible ?? true);
}

describe("highlight mapping page", () => {
  it("retains the selected output when the default Profile toggle changes", () => {
    const { row, update, rebuild } = setup();
    const setEnabled = (enabled: boolean) =>
      update({
        "note.default-profile": {
          bindings: {
            ...defaults["note.default-profile"].bindings,
            "note.import-colored-highlights": enabled,
          },
        },
      });
    setEnabled(true);

    const dropdown = renderRow(row(m.annot_view_color_blue()))
      .components[0] as DropdownComponent;
    expect(dropdown.getValue()).toBe("🔵");
    expect(dropdown.options.map(({ value }) => value)).toEqual([
      "mark",
      "🔴",
      "🟠",
      "🟡",
      "🟢",
      "🔵",
      "🟣",
      "custom",
    ]);
    dropdown.choose("mark");
    setEnabled(false);
    setEnabled(true);
    expect(
      (
        renderRow(row(m.annot_view_color_blue()))
          .components[0] as DropdownComponent
      ).getValue(),
    ).toBe("mark");
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it("shows custom input, validates it, and preserves it across output changes", () => {
    const { ctx, row, settings } = setup();
    const dropdown = renderRow(row(m.annot_view_color_blue()))
      .components[0] as DropdownComponent;
    const inputRow = row(
      m.settings_note_import_custom_emoji_name({
        color: m.annot_view_color_blue(),
      }),
    );
    expect(visible(inputRow)).toBe(false);
    dropdown.choose("custom");
    expect(visible(inputRow)).toBe(true);

    const setting = renderRow(inputRow);
    const input = setting.components[0] as TextComponent;
    const emoji = () =>
      highlightEmoji(
        "blue",
        ctx.tab.sync(settings.current)["note.import-highlight-mappings"],
      );
    expect(setting.errorMessage).toBeTruthy();
    expect(emoji()).toBeNull();
    input.type("👩‍🔬");
    expect(setting.errorMessage).toBeNull();
    expect(emoji()).toBe("👩‍🔬");
    input.type("🔴🔵");
    expect(setting.errorMessage).toBeTruthy();
    expect(emoji()).toBeNull();
    input.type("👩‍🔬");
    dropdown.choose("🟠");
    expect(visible(inputRow)).toBe(false);
    expect(emoji()).toBe("🟠");
    dropdown.choose("custom");
    expect(
      (renderRow(inputRow).components[0] as TextComponent).getValue(),
    ).toBe("👩‍🔬");
    expect(emoji()).toBe("👩‍🔬");
  });
});

effectIt.effect("asks for no rebuild when the mapping save fails", () =>
  Effect.gen(function* () {
    const update = vi.fn<PluginSettings["Service"]["update"]>(() =>
      Effect.fail(
        new SettingsMutationError({
          message: "Settings are read-only",
          cause: null,
        }),
      ),
    );
    const settings = stubService<PluginSettings["Service"]>("PluginSettings", {
      current: Effect.succeed(defaults),
      update,
    });
    const rebuild = vi.fn<() => void>();
    const { tab } = yield* scopedSettingTab(
      Context.make(PluginSettings, settings),
      { update: rebuild },
    );
    const ctx = stubService<SettingTabContext>("SettingTabContext", { tab });
    const blue = highlightMappingItems(ctx).find(
      (entry) => "name" in entry && entry.name === m.annot_view_color_blue(),
    )!;
    const dropdown = renderRow(blue).components[0] as DropdownComponent;

    dropdown.choose("mark");
    yield* eventually(() => expect(update).toHaveBeenCalledOnce());
    expect(rebuild).not.toHaveBeenCalled();
  }),
);
