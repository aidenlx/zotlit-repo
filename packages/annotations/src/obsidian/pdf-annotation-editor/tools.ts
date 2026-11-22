import * as v from "valibot";

import type { ResolvedAnnotationTypeName } from "@zotlit/db";
import {
  ANNOTATION_COLORS,
  isColor,
  withRecentColor,
} from "@zotlit/plugin-kernel/annotation-colors.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

export const ANNOTATION_TOOLS = [
  "highlight",
  "underline",
  "note",
  "text",
  "image",
  "ink",
] as const satisfies readonly ResolvedAnnotationTypeName[];

export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];

export const MARK_TOOLS = [
  "highlight",
  "underline",
  "note",
  "text",
  "image",
  "ink",
] as const;

export type MarkTool = (typeof MARK_TOOLS)[number];

export const TOOL_GESTURES = {
  highlight: "selection",
  underline: "selection",
  note: "click",
  text: "click",
  image: "rectangle",
  ink: "stroke",
} as const satisfies Record<
  MarkTool,
  "selection" | "click" | "rectangle" | "stroke"
>;

type ToolGesture = (typeof TOOL_GESTURES)[MarkTool];

export function gestureOf(armed: MarkTool | null): ToolGesture | null {
  return armed === null ? null : TOOL_GESTURES[armed];
}

export type SelectionTool = {
  [T in MarkTool]: (typeof TOOL_GESTURES)[T] extends "selection" ? T : never;
}[MarkTool];

export function isSelectionTool(tool: MarkTool | null): tool is SelectionTool {
  return gestureOf(tool) === "selection";
}

export type ClickTool = {
  [T in MarkTool]: (typeof TOOL_GESTURES)[T] extends "click" ? T : never;
}[MarkTool];

export function isClickTool(tool: MarkTool | null): tool is ClickTool {
  return gestureOf(tool) === "click";
}

export function selectionToolOf(armed: MarkTool | null): SelectionTool {
  return isSelectionTool(armed) ? armed : "highlight";
}

export function isMarkTool(tool: AnnotationTool): tool is MarkTool {
  return (MARK_TOOLS as readonly AnnotationTool[]).includes(tool);
}

export function defaultToolColor(tool: AnnotationTool): string {
  return tool === "ink" ? ANNOTATION_COLORS[3]! : ANNOTATION_COLORS[0]!;
}

export const TOOL_COLORS_SETTING = "reader.annotation-colors";

export const RECENT_COLORS_SETTING = "reader.recent-colors";

export const annotationToolColorsSchema = v.record(
  v.picklist(ANNOTATION_TOOLS),
  v.string(),
);

export type AnnotationToolColors = v.InferOutput<
  typeof annotationToolColorsSchema
>;

export function resolveToolColors(
  stored: AnnotationToolColors = {},
): Record<AnnotationTool, string> {
  return Object.fromEntries(
    ANNOTATION_TOOLS.map((tool) => [
      tool,
      stored[tool] ?? defaultToolColor(tool),
    ]),
  ) as Record<AnnotationTool, string>;
}

export const INK_WIDTHS = [0.4, 1, 2, 3, 5, 8, 12] as const;

export type InkWidth = (typeof INK_WIDTHS)[number];

export const DEFAULT_INK_WIDTH: InkWidth = 2;

export const INK_WIDTH_SETTING = "reader.ink-width";

export const inkWidthSchema = v.picklist(INK_WIDTHS);

export const TEXT_FONT_SIZES = [10, 12, 14, 18, 24, 36] as const;

export type TextFontSize = (typeof TEXT_FONT_SIZES)[number];

export const DEFAULT_TEXT_FONT_SIZE: TextFontSize = 14;

export const TEXT_FONT_SIZE_SETTING = "reader.text-font-size";

export const textFontSizeSchema = v.picklist(TEXT_FONT_SIZES);

export interface ToolColorStore {
  current: () => Readonly<Record<AnnotationTool, string>>;
  set: (tool: AnnotationTool, color: string) => void;
  recent: () => readonly string[];
  use: (color: string) => void;
  inkWidth: () => InkWidth;
  setInkWidth: (width: InkWidth) => void;
  textFontSize: () => TextFontSize;
  setTextFontSize: (size: TextFontSize) => void;
}

export function toolColorStore(
  settings: Pick<PluginSettings["Service"], "current" | "update">,
  bridge: Pick<EffectBridge, "runSync">,
): ToolColorStore {
  return {
    current: () =>
      resolveToolColors(bridge.runSync(settings.current)[TOOL_COLORS_SETTING]),
    set: (tool: AnnotationTool, color: string) => {
      const stored = bridge.runSync(settings.current)[TOOL_COLORS_SETTING];
      bridge.runSync(
        settings.update({
          [TOOL_COLORS_SETTING]: { ...stored, [tool]: color },
        }),
      );
    },
    recent: () => bridge.runSync(settings.current)[RECENT_COLORS_SETTING],
    use: (color: string) => {
      const stored = bridge.runSync(settings.current)[RECENT_COLORS_SETTING];
      if (isColor(stored[0] ?? null, color)) return;
      bridge.runSync(
        settings.update({
          [RECENT_COLORS_SETTING]: withRecentColor(stored, color),
        }),
      );
    },
    inkWidth: () => bridge.runSync(settings.current)[INK_WIDTH_SETTING],
    setInkWidth: (width: InkWidth) => {
      bridge.runSync(settings.update({ [INK_WIDTH_SETTING]: width }));
    },
    textFontSize: () =>
      bridge.runSync(settings.current)[TEXT_FONT_SIZE_SETTING],
    setTextFontSize: (size: TextFontSize) => {
      bridge.runSync(settings.update({ [TEXT_FONT_SIZE_SETTING]: size }));
    },
  };
}
