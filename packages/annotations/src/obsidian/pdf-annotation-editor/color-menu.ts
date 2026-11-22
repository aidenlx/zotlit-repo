import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";
import type { Menu } from "obsidian";

import { menuEvent, menuSections } from "@zotlit/obsidian-kit/menu-events.ts";
import {
  ANNOTATION_COLORS,
  annotationColorLabel,
  isColor,
} from "@zotlit/plugin-kernel/annotation-colors.ts";

import type { MarkTool } from "./tools.ts";

declare module "@zotlit/obsidian-kit/menu-events.ts" {
  interface ZotLitMenuEvents {
    "zotlit:annotation-color-menu":
      | {
          source: "annotation-view" | "pdf-mark";
          annotations: readonly AnnotationRecord[];
        }
      | { source: "pdf-tool"; tool: MarkTool };
  }
}

export const annotationColorMenu = menuEvent("zotlit:annotation-color-menu", [
  "color",
  "ink-width",
  "font-size",
  "",
]);

const SECTION = menuSections(annotationColorMenu);

export interface ColorMenuInput {
  colors: readonly (string | null)[];
  onSelect: (hex: string) => void;
}

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
