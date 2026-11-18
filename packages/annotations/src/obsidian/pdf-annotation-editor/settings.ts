// The reader keys of the plugin settings, registered in the platform's
// settings registry; a host composes the slice into its definition.
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
    /**
     * Whether a clicked Attachment File Link opens in Obsidian's PDF view
     * instead of the system handler — File Link Capture, ADR 0045.
     */
    "reader.open-file-links": v.boolean(),
    /**
     * Open a clicked Durable Annotation Link in Obsidian's reader, with the
     * Annotation selected; off hands it to Zotero.
     */
    "reader.open-annotation-links": v.boolean(),
    /**
     * The colour each PDF reader annotation tool draws in. Sparse, so a tool
     * never recoloured follows Zotero's own default.
     */
    "reader.annotation-colors": annotationToolColorsSchema,
    /**
     * The annotation colours used last in the PDF reader, most recent first. One
     * list for every tool, so the popup offers the same swatches to each.
     */
    "reader.recent-colors": v.array(v.string()),
    /** The pen width the PDF reader's ink tool draws at, in PDF points. */
    "reader.ink-width": inkWidthSchema,
    /** The font size the PDF reader's text tool types at, in PDF points. */
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
