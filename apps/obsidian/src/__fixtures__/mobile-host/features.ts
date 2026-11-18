// A host without Node: the platform and every feature's Obsidian value, as
// ZotLit Mobile would compose them, with a stub for each port those values
// read and no Obsidian value fills. `host.check.ts` declares it as a host
// in a program without the desktop files (`tsconfig.mobile.json`), and
// `src/mobile-host.test.ts` builds its services.
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
