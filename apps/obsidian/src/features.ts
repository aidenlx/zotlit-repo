// The features of desktop ZotLit, in the order their services, registrations
// and start-up hooks run.
import { annotations } from "@zotlit/annotations/desktop/feature.ts";
import { citations } from "@zotlit/citations/desktop/feature.ts";
import { libraryView } from "@zotlit/library-view/desktop/feature.ts";
import { notes } from "@zotlit/notes/desktop/feature.ts";
import { desktopPlatform } from "@zotlit/plugin-shell/desktop/platform.ts";
import { platform } from "@zotlit/plugin-shell/obsidian/platform.ts";
import { queryViews } from "@zotlit/query-views/desktop/feature.ts";
import { templateWorkbench } from "@zotlit/template-workbench/desktop/feature.ts";

import { desktopCapabilities } from "./capabilities.ts";
import { hostPages } from "./setting-tab/pages.ts";

export const features = [
  platform,
  desktopPlatform,
  desktopCapabilities,
  annotations,
  citations,
  notes,
  templateWorkbench,
  queryViews,
  libraryView,
  hostPages,
] as const;
