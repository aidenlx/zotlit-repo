import { Layer } from "effect";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { settingTabHarness } from "@zotlit/plugin-services/__fixtures__/setting-tab-harness.ts";
import { unimplementedPlatformTabServices } from "@zotlit/plugin-services/__fixtures__/setting-tab-services.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";

import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";
import { ExcerptDisplays } from "#desktop/excerpt-image/display.ts";
import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";

export const unimplementedTabServices = Layer.mergeAll(
  layerUnreadViewServices,
  unimplementedPlatformTabServices,
  Layer.mock(ZoteroLocalApi)({}),
  Layer.succeed(
    ExcerptImageService,
    stubService<ExcerptImageService["Service"]>("ExcerptImages", {}),
  ),
  Layer.succeed(
    ExcerptDisplays,
    stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {}),
  ),
);

export const { scopedSettingTab, rebuildingSettingTab, testSettingTab } =
  settingTabHarness(unimplementedTabServices);
