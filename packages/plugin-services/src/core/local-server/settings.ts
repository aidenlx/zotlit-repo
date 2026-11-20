// The Local Server keys of the plugin settings.

import type { SliceSettings } from "#core/settings/slice.ts";
import * as v from "valibot";

import { settingsNumber, settingsSlice } from "#core/settings/slice.ts";

const serverPort = v.pipe(
  settingsNumber,
  v.integer(),
  v.minValue(0),
  v.maxValue(65535),
);

export const serverSettings = settingsSlice(
  {
    "server.enabled": v.boolean(),
    "server.live-update": v.boolean(),
    "server.workbench": v.boolean(),
    "server.port": serverPort,
    "server.hostname": v.string(),
  },
  {
    "server.enabled": false,
    "server.live-update": true,
    "server.workbench": true,
    "server.port": 9091,
    "server.hostname": "127.0.0.1",
  },
);

declare module "#core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof serverSettings> {}
}
