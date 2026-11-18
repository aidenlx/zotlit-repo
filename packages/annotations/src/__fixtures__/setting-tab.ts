// The tab service over the services this package's tab rows read, for their
// tests: the platform's stand-ins and this package's view services. A host's
// program registers more services, which these tests never read.
import { Layer } from "effect";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { settingTabHarness } from "@zotlit/plugin-services/__fixtures__/setting-tab-harness.ts";
import { unimplementedPlatformTabServices } from "@zotlit/plugin-services/__fixtures__/setting-tab-services.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";

import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";
import { ExcerptDisplays } from "#desktop/excerpt-image/display.ts";
import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";

/** Every service this package's tab rows read, with no member implemented. */
export const unimplementedTabServices = Layer.mergeAll(
  layerUnreadViewServices,
  unimplementedPlatformTabServices,
  Layer.mock(ZoteroLocalApi)({}),
  // Services with plain members: a read of a member no test gave throws.
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
