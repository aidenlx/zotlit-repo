import { Layer } from "effect";

import { settingTabHarness } from "@zotlit/plugin-services/__fixtures__/setting-tab-harness.ts";
import { unimplementedPlatformTabServices } from "@zotlit/plugin-services/__fixtures__/setting-tab-services.ts";

import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";

export const unimplementedTabServices = Layer.mergeAll(
  layerUnreadViewServices,
  unimplementedPlatformTabServices,
);

export const { scopedSettingTab, rebuildingSettingTab, testSettingTab } =
  settingTabHarness(unimplementedTabServices);
