import { annotations } from "@zotlit/annotations/obsidian/feature.ts";
import { citations } from "@zotlit/citations/obsidian/feature.ts";
import { libraryView } from "@zotlit/library-view/obsidian/feature.ts";
import { notes } from "@zotlit/notes/obsidian/feature.ts";
import { platform } from "@zotlit/plugin-shell/obsidian/platform.ts";
import { queryViews } from "@zotlit/query-views/obsidian/feature.ts";
import { templateWorkbench } from "@zotlit/template-workbench/obsidian/feature.ts";

import { mobileCapabilities } from "./capabilities.ts";

export const mobileFeatures = [
  platform,
  mobileCapabilities,
  annotations,
  citations,
  notes,
  templateWorkbench,
  queryViews,
  libraryView,
] as const;
