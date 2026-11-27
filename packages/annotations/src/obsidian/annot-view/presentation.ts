import type { EditingCapability } from "#obsidian/annotation-repository/capability.ts";
import type { IconName } from "obsidian";

import type { AnnotViewAttachment } from "@zotlit/db";
import type { ItemSummary } from "@zotlit/plugin-kernel/item-summary.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { AnnotState, FollowMode } from "./state.ts";
import { selectActiveAttachment } from "./state.ts";

import { editingCapabilityCopy } from "#obsidian/annotation-repository/capability-copy.ts";

const FOLLOW_MODES = {
  "active-tab": {
    icon: "app-window",
    label: () => m.annot_view_mode_active_tab(),
  },
  "zotero-reader": {
    icon: "book-open",
    label: () => m.annot_view_mode_zotero_reader(),
  },
  pinned: { icon: "pin", label: () => m.annot_view_mode_pinned() },
} as const satisfies Record<
  FollowMode,
  { icon: IconName; label: () => string }
>;

export function followModeLabel(mode: FollowMode): string {
  return FOLLOW_MODES[mode].label();
}

export function followModeIcon(mode: FollowMode): IconName {
  return FOLLOW_MODES[mode].icon;
}

const FOLLOW_MODE_STATUS: Record<FollowMode, () => string> = {
  "active-tab": () => m.annot_view_header_following_active_tab(),
  "zotero-reader": () => m.annot_view_header_following_zotero_reader(),
  pinned: () => m.annot_view_header_pinned_item(),
};

export function followModeStatus(mode: FollowMode): string {
  return FOLLOW_MODE_STATUS[mode]();
}

export type FollowMenuState = Pick<AnnotState, "followMode" | "pinnable">;

export type FollowMenuAction =
  | Exclude<FollowMode, "pinned">
  | "pin-current-item"
  | "unpin"
  | "choose-item";

export interface FollowMenuEntry {
  action: FollowMenuAction;
  label: string;
  icon: IconName;
}

export function followModeMenu(state: FollowMenuState): FollowMenuEntry[] {
  const switchTo = (mode: Exclude<FollowMode, "pinned">): FollowMenuEntry => ({
    action: mode,
    label: followModeLabel(mode),
    icon: followModeIcon(mode),
  });
  return [
    switchTo("active-tab"),
    switchTo("zotero-reader"),
    ...pinEntry(state),
    {
      action: "choose-item",
      label: m.annot_view_pin_choose_item(),
      icon: "search",
    },
  ];
}

function pinEntry(state: FollowMenuState): FollowMenuEntry[] {
  if (state.followMode === "pinned") {
    return [
      { action: "unpin", label: m.annot_view_mode_unpin(), icon: "pin-off" },
    ];
  }
  if (state.pinnable === null) return [];
  return [
    {
      action: "pin-current-item",
      label: m.annot_view_mode_pin_current_item(),
      icon: "pin",
    },
  ];
}

export type AttachmentLine =
  | { kind: "hidden" }
  | { kind: "locked"; label: string; reason: string }
  | {
      kind: "picker";
      selectedKey: string;
      options: { key: string; label: string }[];
    };

export function attachmentLabel(attachment: AnnotViewAttachment): string {
  const path = attachment.path?.replace(/^storage:/, "");
  return m.annot_view_attachment_label({
    name: path && path.length > 0 ? path : m.annot_view_attachment_unnamed(),
    count: attachment.annotCount,
  });
}

export type AttachmentLineState = Pick<
  AnnotState,
  "attachments" | "selectedAttachmentKey" | "attachmentLock"
>;

export function attachmentLine(state: AttachmentLineState): AttachmentLine {
  const active = selectActiveAttachment(state);
  if (!active || state.attachmentLock === "obsidian-pdf") {
    return { kind: "hidden" };
  }
  if (state.attachmentLock === "zotero-reader") {
    return {
      kind: "locked",
      label: attachmentLabel(active),
      reason: m.annot_view_attachment_locked_reader(),
    };
  }
  const attachments = state.attachments ?? [];
  if (attachments.length <= 1) return { kind: "hidden" };
  return {
    kind: "picker",
    selectedKey: active.indexedKey,
    options: attachments.map((attachment) => ({
      key: attachment.indexedKey,
      label: attachmentLabel(attachment),
    })),
  };
}

export type EmptyStateAction = "enable-live-updates" | "choose-item";

export type AnnotViewBody =
  | { kind: "list" }
  | { kind: "loading" }
  | { kind: "problem"; message: string; detail: string }
  | { kind: "no-attachments"; message: string }
  | {
      kind: "empty";
      message: string;
      action: { label: string; action: EmptyStateAction } | null;
    };

export type AnnotViewBodyState = Pick<
  AnnotState,
  | "attachments"
  | "annotations"
  | "followMode"
  | "liveUpdatesOn"
  | "pinnedItemKey"
  | "queryProblem"
>;

export function annotViewBody(state: AnnotViewBodyState): AnnotViewBody {
  if (state.queryProblem !== null && state.annotations === null)
    return { kind: "problem", ...state.queryProblem };
  if (state.attachments === null) return emptyState(state);
  if (state.attachments.length === 0) {
    return { kind: "no-attachments", message: m.annot_view_no_attachments() };
  }
  if (state.annotations === null) return { kind: "loading" };
  return { kind: "list" };
}

function emptyState(state: AnnotViewBodyState): AnnotViewBody {
  const chooseItem = {
    label: m.annot_view_pin_choose_item(),
    action: "choose-item" as const,
  };
  switch (state.followMode) {
    case "zotero-reader":
      return state.liveUpdatesOn
        ? {
            kind: "empty",
            message: m.annot_view_empty_zotero_reader(),
            action: null,
          }
        : {
            kind: "empty",
            message: m.annot_view_empty_live_updates_off(),
            action: {
              label: m.annot_view_enable_live_updates(),
              action: "enable-live-updates",
            },
          };
    case "pinned":
      return state.pinnedItemKey === null
        ? {
            kind: "empty",
            message: m.annot_view_empty_pinned(),
            action: chooseItem,
          }
        : {
            kind: "empty",
            message: m.annot_view_empty_pinned_unresolved(),
            action: chooseItem,
          };
    case "active-tab":
      return {
        kind: "empty",
        message: m.annot_view_empty_active_tab(),
        action: null,
      };
  }
}

function headerIdentity(
  state: Pick<AnnotState, "followMode" | "itemDisplay">,
): ItemSummary | null {
  return state.followMode === "active-tab" ? null : state.itemDisplay;
}

export type HeaderState = Pick<
  AnnotState,
  | "attachmentLock"
  | "attachments"
  | "capability"
  | "followMode"
  | "itemDisplay"
  | "selectedAttachmentKey"
  | "zoteroReaderClosed"
>;

export type HeaderShape =
  | {
      kind: "masthead";
      modeIcon: IconName;
      title: string;
      byline: string[];
      label: string;
    }
  | {
      kind: "status-bar";
      modeIcon: IconName;
      modeLabel: string;
      indicators: string[];
      label: string;
    };

export function headerShape(state: HeaderState): HeaderShape {
  const modeIcon = followModeIcon(state.followMode);
  const indicators = headerIndicators(state);
  const item = headerIdentity(state);
  if (item === null) {
    const modeLabel = followModeStatus(state.followMode);
    return {
      kind: "status-bar",
      modeIcon,
      modeLabel,
      indicators,
      label: headerLabel([modeLabel, ...indicators]),
    };
  }
  return {
    kind: "masthead",
    modeIcon,
    title: item.title,
    byline: [item.subtitle, ...indicators].filter((part) => part.length > 0),
    label: headerLabel([
      item.title,
      followModeLabel(state.followMode),
      ...indicators,
    ]),
  };
}

export function headerIndicators(state: HeaderState): string[] {
  const indicators: string[] = [];
  const count = attachmentChoiceCount(state);
  if (count !== null) {
    indicators.push(m.annot_view_header_attachments({ count }));
  }
  if (readingOnly(state.capability)) {
    indicators.push(m.annot_view_header_reading_only());
  }
  if (readerClosed(state)) {
    indicators.push(m.annot_view_header_reader_closed());
  }
  return indicators;
}

function headerLabel(segments: readonly string[]): string {
  return segments
    .map((text) => m.annot_view_header_aria_sentence({ text }))
    .join(" ");
}

function attachmentChoiceCount(state: HeaderState): number | null {
  const line = attachmentLine(state);
  return line.kind === "picker" ? line.options.length : null;
}

function readingOnly(capability: EditingCapability): boolean {
  if (capability.kind === "writable") return false;
  return !(capability.kind === "read-only" && capability.reason === "probing");
}

function readerClosed(
  state: Pick<AnnotState, "attachments" | "followMode" | "zoteroReaderClosed">,
): boolean {
  return (
    state.followMode === "zotero-reader" &&
    state.zoteroReaderClosed &&
    state.attachments !== null
  );
}

export type HeaderMenuAction =
  | { kind: "follow"; follow: FollowMenuAction }
  | { kind: "choose-attachment" }
  | { kind: "open-pdf" }
  | { kind: "allow-editing" };

export interface HeaderMenuEntry {
  label: string;
  icon?: IconName;
  report?: true;
  disabled?: true;
  checked?: true;
  action?: HeaderMenuAction;
}

export type HeaderMenuState = HeaderState & FollowMenuState;

export function headerMenu(
  state: HeaderMenuState,
  now: Temporal.Instant,
): HeaderMenuEntry[][] {
  return [
    ...followGroups(state),
    attachmentGroup(state),
    readerClosed(state) ? [report(m.annot_view_reader_closed())] : [],
    capabilityGroup(state.capability, now),
  ].filter((group) => group.length > 0);
}

function report(label: string): HeaderMenuEntry {
  return { label, report: true };
}

function followGroups(state: HeaderMenuState): HeaderMenuEntry[][] {
  const entries = Map.groupBy(followModeMenu(state), (entry) =>
    entry.action === "active-tab" || entry.action === "zotero-reader"
      ? "mode"
      : "pin",
  );
  const follow = (entry: FollowMenuEntry): HeaderMenuEntry => ({
    label: entry.label,
    icon: entry.icon,
    ...(state.followMode === entry.action && { checked: true as const }),
    action: { kind: "follow", follow: entry.action },
  });
  const modes = [
    report(m.annot_view_header_menu_label()),
    ...(entries.get("mode") ?? []).map(follow),
  ];
  if (state.followMode === "pinned") {
    modes.push({
      label: followModeLabel("pinned"),
      icon: followModeIcon("pinned"),
      checked: true,
    });
  }
  return [modes, (entries.get("pin") ?? []).map(follow)];
}

function attachmentGroup(state: HeaderState): HeaderMenuEntry[] {
  const rows = attachmentChoiceRows(state);
  if (
    selectActiveAttachment(state) !== null &&
    state.attachmentLock !== "obsidian-pdf"
  ) {
    rows.push({
      label: m.command_open_pdf_name(),
      icon: "file-text",
      action: { kind: "open-pdf" },
    });
  }
  return rows;
}

function attachmentChoiceRows(state: HeaderState): HeaderMenuEntry[] {
  const line = attachmentLine(state);
  switch (line.kind) {
    case "hidden":
      return [];
    case "locked":
      return [
        { label: line.label, icon: "lock", disabled: true },
        report(line.reason),
      ];
    case "picker":
      return [
        {
          label: m.annot_view_attachment_choose(),
          icon: "paperclip",
          action: { kind: "choose-attachment" },
        },
      ];
  }
}

function capabilityGroup(
  capability: EditingCapability,
  now: Temporal.Instant,
): HeaderMenuEntry[] {
  if (!readingOnly(capability)) return [];
  const rows = [report(editingCapabilityCopy(capability, now).label)];
  if (capability.kind === "authorization-required") {
    rows.push({
      label: m.capability_enable_editing(),
      icon: "pencil",
      action: { kind: "allow-editing" },
    });
  }
  return rows;
}
