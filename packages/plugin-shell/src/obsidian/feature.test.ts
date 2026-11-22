import { Context, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import {
  defineFeature,
  extendFeature,
  registration,
  serviceGroup,
} from "./feature.ts";
import type { FeatureContext } from "./feature.ts";

class First extends Context.Service<First, { readonly n: number }>()(
  "zotlit/test/First",
) {}
class Second extends Context.Service<Second, { readonly n: number }>()(
  "zotlit/test/Second",
) {}

const base = defineFeature({
  name: "notes",
  services: [
    serviceGroup(
      "First",
      { provides: [First] },
      Layer.succeed(First, { n: 1 }),
    ),
  ],
  registrations: [registration("BaseRows", Layer.empty)],
  settingTab: {
    entries: { main: () => [{ id: "base", name: "base" }] },
    slots: { "test.rows": () => [{ id: "base-row", name: "base-row" }] },
  },
  handles: () => ({ fromBase: 1 }),
  onload: () => ({ fileMenu: { base: () => {} } }),
});

const desktop = extendFeature(base, {
  services: [
    serviceGroup(
      "Second",
      { provides: [Second] },
      Layer.succeed(Second, { n: 2 }),
    ),
  ],
  registrations: [registration("DesktopRows", Layer.empty)],
  settingTab: {
    slots: { "test.rows": () => [{ id: "desktop-row", name: "desktop-row" }] },
  },
  handles: () => ({ fromDesktop: 2 }),
  onload: () => ({ fileMenu: { desktop: () => {} } }),
});

declare module "@zotlit/plugin-services/obsidian/setting-tab/context.ts" {
  interface SettingTabSlots {
    "test.rows": unknown;
  }
}

const ctx = stubService<SettingTabContext>("SettingTabContext", {});
const featureCtx = stubService<FeatureContext>("FeatureContext", {});

describe("extendFeature", () => {
  it("keeps the base's name and puts its parts first", () => {
    expect(desktop.name).toBe("notes");
    expect(desktop.base).toBe(base);
    expect(desktop.services.map(({ name }) => name)).toEqual([
      "First",
      "Second",
    ]);
    expect(desktop.registrations.map(({ name }) => name)).toEqual([
      "BaseRows",
      "DesktopRows",
    ]);
    expect(desktop.settingTab.entries?.main?.(ctx)).toEqual([
      { id: "base", name: "base" },
    ]);
  });

  it("gives a slot both fill the base's rows, then the extension's", () => {
    expect(desktop.settingTab.slots?.["test.rows"]?.(ctx)).toEqual([
      { id: "base-row", name: "base-row" },
      { id: "desktop-row", name: "desktop-row" },
    ]);
  });

  it("merges the handles and the menus of both", () => {
    expect(desktop.handles(featureCtx)).toEqual({
      fromBase: 1,
      fromDesktop: 2,
    });
    expect(Object.keys(desktop.onload(featureCtx)?.fileMenu ?? {})).toEqual([
      "base",
      "desktop",
    ]);
  });

  it("refuses a setting entry the base already gives", () => {
    expect(() =>
      extendFeature(base, { settingTab: { entries: { main: () => [] } } }),
    ).toThrow("notes gives the setting entry main twice");
  });
});
