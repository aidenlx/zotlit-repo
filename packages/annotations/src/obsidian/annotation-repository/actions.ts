import type { Plugin } from "obsidian";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { CopyInstant } from "./capability-copy.ts";
import type { HistoryDirection, HistoryOutcome } from "./history.ts";
import type { AnnotationRepository } from "./service.ts";
import { writeFailureMessage } from "./write.ts";

import { lockReasonText } from "#core/annotation-repository/lock-copy.ts";

export const HISTORY_DIRECTIONS: readonly HistoryDirection[] = ["undo", "redo"];

export interface HistorySurface {
  readonly historyAttachment: string | null;
  stepHistory(direction: HistoryDirection): void;
}

export interface AnnotationHistoryActionDeps {
  annotations: Pick<AnnotationRepository["Service"], "canRedo" | "canUndo">;
  bridge: Pick<EffectBridge, "runSync">;
  activeSurface: () => HistorySurface | null;
}

export function historyOutcomeNotice(
  outcome: HistoryOutcome,
  now: CopyInstant,
): string | null {
  switch (outcome.kind) {
    case "changed":
      return m.annot_history_changed_in_zotero();
    case "failed":
      return writeFailureMessage(outcome.failure, now);
    case "locked":
      return lockReasonText(outcome.reason);
    case "stepped":
      return outcome.restoredAsCreator
        ? m.annot_history_restored_new_creator({
            count: outcome.restoredAsCreator.count,
          })
        : null;
    case "removed":
    case "blocked":
    case "idle":
      return null;
  }
}

export function historyCommandName(direction: HistoryDirection): string {
  return direction === "undo"
    ? m.command_undo_annotation_change_name()
    : m.command_redo_annotation_change_name();
}

export function historyStands({
  annotations,
  bridge,
  attachmentKey,
  direction,
}: {
  annotations: Pick<AnnotationRepository["Service"], "canRedo" | "canUndo">;
  bridge: Pick<EffectBridge, "runSync">;
  attachmentKey: string;
  direction: HistoryDirection;
}): boolean {
  return direction === "undo"
    ? bridge.runSync(annotations.canUndo(attachmentKey))
    : bridge.runSync(annotations.canRedo(attachmentKey));
}

export function addAnnotationHistoryActions(
  plugin: Pick<Plugin, "addCommand">,
  deps: AnnotationHistoryActionDeps,
): void {
  for (const direction of HISTORY_DIRECTIONS) {
    plugin.addCommand({
      id: `${direction}-annotation-change`,
      name: historyCommandName(direction),
      checkCallback(checking) {
        const surface = deps.activeSurface();
        const attachmentKey = surface?.historyAttachment ?? null;
        if (!surface || attachmentKey === null) return false;
        if (
          !historyStands({
            annotations: deps.annotations,
            bridge: deps.bridge,
            attachmentKey,
            direction,
          })
        ) {
          return false;
        }
        if (!checking) surface.stepHistory(direction);
        return true;
      },
    });
  }
}
