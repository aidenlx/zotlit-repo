// The tab service over the services this package's tab rows read, for their
// tests: the platform's stand-ins, the notes' view services and this package's
// Customize flow. A host's program registers more services, which these
// tests never read.
import { Layer } from "effect";

import { layerUnreadViewServices } from "@zotlit/notes/__fixtures__/view-atoms.ts";
import { settingTabHarness } from "@zotlit/plugin-services/__fixtures__/setting-tab-harness.ts";
import { unimplementedPlatformTabServices } from "@zotlit/plugin-services/__fixtures__/setting-tab-services.ts";

import { Customize } from "#desktop/view/customize.ts";

/** Every service this package's tab rows read, with no member implemented. */
export const unimplementedTabServices = Layer.mergeAll(
  layerUnreadViewServices,
  unimplementedPlatformTabServices,
  Layer.mock(Customize)({}),
);

export const { scopedSettingTab, rebuildingSettingTab, testSettingTab } =
  settingTabHarness(unimplementedTabServices);
