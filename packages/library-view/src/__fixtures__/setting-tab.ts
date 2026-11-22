import { Layer } from "effect";

import { ExcerptImageService } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { settingTabHarness } from "@zotlit/plugin-services/__fixtures__/setting-tab-harness.ts";
import { unimplementedPlatformTabServices } from "@zotlit/plugin-services/__fixtures__/setting-tab-services.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import { Customize } from "@zotlit/template-workbench/desktop/view/customize.ts";

import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";

export const unimplementedTabServices = Layer.mergeAll(
  layerUnreadViewServices,
  unimplementedPlatformTabServices,
  Layer.mock(ZoteroLocalApi)({}),
  Layer.mock(Customize)({}),
  Layer.succeed(
    ExcerptImageService,
    stubService<ExcerptImageService["Service"]>("ExcerptImages", {}),
  ),
);

export const { scopedSettingTab, rebuildingSettingTab, testSettingTab } =
  settingTabHarness(unimplementedTabServices);
