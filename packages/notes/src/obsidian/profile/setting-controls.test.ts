import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect, vi } from "vitest";

import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import {
  profileControlValue,
  setProfileControlValue,
} from "./setting-controls.ts";

import { rebuildingSettingTab } from "#__fixtures__/setting-tab.ts";
import { defaults } from "#__fixtures__/settings.ts";

describe("Profile settings", () => {
  it.effect("writes only default bindings through the settings controls", () =>
    Effect.gen(function* () {
      const settings = {
        current: Effect.succeed(defaults),
        update: vi.fn(
          (_patch: Parameters<PluginSettings["Service"]["update"]>[0]) =>
            Effect.succeed(defaults),
        ),
      };
      const { tab } = yield* rebuildingSettingTab(
        Layer.mock(PluginSettings, settings),
      );
      expect(tab.sync(profileControlValue("note-profile:default:folder"))).toBe(
        "literatures",
      );
      tab.sync(
        setProfileControlValue("note-profile:default:folder", "Reading"),
      );
      expect(settings.update).toHaveBeenCalledTimes(1);
      const [patch] = settings.update.mock.calls[0]!;
      expect(typeof patch === "function" ? patch(defaults) : patch).toEqual({
        "note.default-profile": {
          bindings: {
            ...defaults["note.default-profile"].bindings,
            "note.literature-folder": "Reading",
          },
        },
      });
    }),
  );
});
