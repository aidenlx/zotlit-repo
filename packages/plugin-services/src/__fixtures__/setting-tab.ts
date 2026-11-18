// The tab service over the services this package's tab rows read, for their
// tests.
import { settingTabHarness } from "./setting-tab-harness.ts";
import { unimplementedPlatformTabServices } from "./setting-tab-services.ts";

export const { scopedSettingTab, rebuildingSettingTab, testSettingTab } =
  settingTabHarness(unimplementedPlatformTabServices);
