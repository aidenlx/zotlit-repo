// The one colour menu every surface that recolours opens: Zotero's eight
// swatches, under the section the annotation colour menu registers.

import type { Menu } from "obsidian";

import {
  ANNOTATION_COLORS,
  annotationColorLabel,
  isColor,
} from "@zotlit/plugin-kernel/annotation-colors.ts";

import { menuSections } from "@/services/menu-events.ts";

const SECTION = menuSections("zotlit:annotation-color-menu");

export interface ColorMenuInput {
  /**
   * The colours in hand, one for each Annotation the menu recolours, in
   * whatever case each was stored. An entry shows checked only where every one
   * of them is that colour, so a mixed group checks none.
   */
  colors: readonly (string | null)[];
  onSelect: (hex: string) => void;
}

/**
 * Zotero's eight swatches as menu entries. Each title is a fragment, so the
 * colour itself stands beside its name the way an Annotation card's own dot
 * does — `setTitle` takes a `DocumentFragment`, so this needs nothing private.
 *
 * Written once here because every surface that recolours — the Annotation
 * View's card, the reader's mark popup, the reader's creation toolbar — offers
 * the same palette, and none of them may drift from the others.
 */
export function buildColorMenu(
  menu: Menu,
  { colors, onSelect }: ColorMenuInput,
): void {
  for (const hex of ANNOTATION_COLORS) {
    menu.addItem((item) =>
      item
        .setSection(SECTION.color)
        .setTitle(swatchTitle(hex))
        .setChecked(
          colors.length > 0 && colors.every((color) => isColor(color, hex)),
        )
        .onClick(() => onSelect(hex)),
    );
  }
}

function swatchTitle(hex: string): DocumentFragment {
  return createFragment((frag) => {
    const row = frag.createSpan({
      cls: "zt:inline-flex zt:items-center zt:gap-2",
    });
    row.createSpan({
      cls: "zt:size-3 zt:shrink-0 zt:rounded-full zt:ring-1 zt:ring-border",
      attr: { style: `background-color: ${hex}` },
    });
    row.createSpan({ text: annotationColorLabel(hex) });
  });
}
