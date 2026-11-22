import { settingTabHarness } from "./setting-tab-harness.ts";
import { unimplementedPlatformTabServices } from "./setting-tab-services.ts";

export const { scopedSettingTab, rebuildingSettingTab, testSettingTab } =
  settingTabHarness(unimplementedPlatformTabServices);
