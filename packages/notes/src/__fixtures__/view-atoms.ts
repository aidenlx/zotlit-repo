// The view services a test host of this package leaves unread, so its registry
// context is whole. Each member dies when called. Only this package's tests
// read it: a host's program registers more view services.
import { Layer } from "effect";

import { layerUnreadViewServices as layerUnreadCitationViewServices } from "@zotlit/citations/__fixtures__/view-atoms.ts";

import { ItemMatchQuery } from "#core/profile-selection/item-matches.ts";
import { NoteFeature } from "#desktop/note-feature/service.ts";
import { TemplateDataReads } from "#desktop/template/data-reads.ts";
import { TemplateMigration } from "#desktop/template/migration.ts";
import { Profile } from "#obsidian/profile/service.ts";
import { Template } from "#obsidian/template/service.ts";
import { TemplateWorkbenchLauncher } from "#obsidian/template/workbench-launcher.ts";

/**
 * Every view service outside the Obsidian host tags, as an empty mock. Merge
 * it first: a service the test reads, merged after it, takes its place.
 */
export const layerUnreadViewServices = Layer.mergeAll(
  layerUnreadCitationViewServices,
  Layer.mock(NoteFeature, {}),
  Layer.mock(Profile, {}),
  Layer.mock(Template, {}),
  Layer.mock(TemplateMigration, {}),
  Layer.mock(TemplateDataReads, {}),
  Layer.mock(ItemMatchQuery, {}),
  Layer.mock(TemplateWorkbenchLauncher, {}),
);
