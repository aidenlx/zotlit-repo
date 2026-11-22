import * as v from "valibot";

import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";

import {
  annotationToolColorsSchema,
  DEFAULT_INK_WIDTH,
  DEFAULT_TEXT_FONT_SIZE,
  inkWidthSchema,
  textFontSizeSchema,
} from "./tools.ts";

export const readerSettings = settingsSlice(
  {
    "reader.focus-annot-view": v.boolean(),
    "reader.open-file-links": v.boolean(),
    "reader.open-annotation-links": v.boolean(),
    "reader.annotation-colors": annotationToolColorsSchema,
    "reader.recent-colors": v.array(v.string()),
    "reader.ink-width": inkWidthSchema,
    "reader.text-font-size": textFontSizeSchema,
  },
  {
    "reader.focus-annot-view": true,
    "reader.open-file-links": true,
    "reader.open-annotation-links": true,
    "reader.annotation-colors": {},
    "reader.recent-colors": [],
    "reader.ink-width": DEFAULT_INK_WIDTH,
    "reader.text-font-size": DEFAULT_TEXT_FONT_SIZE,
  },
);

declare module "@zotlit/plugin-services/core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof readerSettings> {}
}
