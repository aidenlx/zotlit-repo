import { FileSystem } from "effect";

import { logSettings } from "@zotlit/plugin-services/core/log/settings.ts";
import {
  defineFeature,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";

export const readerBase = defineFeature({
  name: "reader base",
  settings: [logSettings],
  services: [
    serviceGroup(
      "FileSystem",
      { provides: [FileSystem.FileSystem] },
      FileSystem.layerNoop({}),
    ),
  ],
});
