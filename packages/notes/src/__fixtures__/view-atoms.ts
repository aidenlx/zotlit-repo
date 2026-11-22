import { Layer } from "effect";

import { layerUnreadViewServices as layerUnreadCitationViewServices } from "@zotlit/citations/__fixtures__/view-atoms.ts";

import { ItemMatchQuery } from "#core/profile-selection/item-matches.ts";
import { NoteFeature } from "#desktop/note-feature/service.ts";
import { TemplateDataReads } from "#desktop/template/data-reads.ts";
import { TemplateMigration } from "#desktop/template/migration.ts";
import { Profile } from "#obsidian/profile/service.ts";
import { Template } from "#obsidian/template/service.ts";
import { TemplateWorkbenchLauncher } from "#obsidian/template/workbench-launcher.ts";

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
