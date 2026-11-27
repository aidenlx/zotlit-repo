import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";
import { nanoid } from "nanoid";
import type { App, Editor, MarkdownFileInfo, TFile } from "obsidian";

import { insertionEditor } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { profileRecoveryNotice } from "@zotlit/obsidian-kit/profile-recovery.ts";
import { latestSlot } from "@zotlit/obsidian-kit/view-runner.ts";
import { observeExit } from "@zotlit/plugin-kernel/fiber-exit.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type {
  AnnotationInsertOutcome,
  AnnotationSnapshot,
} from "./note-actions.ts";
export type { AnnotationInsertOutcome } from "./note-actions.ts";

import type { NoticeMessage } from "@zotlit/obsidian-kit/notice.ts";

import { captureInsertion, watchInsertionWorkspace } from "./async-insert.ts";
import type { InsertFiber, InsertRunner } from "./insert-run.ts";
import { startInsert } from "./insert-run.ts";

const SOURCE_TAG = "application/x-zotlit-annotation";

export interface InsertDeps<R> extends InsertRunner<R> {
  app: App;
  snapshot: (annotation: AnnotationRecord) => AnnotationSnapshot;
  notify: (message: NoticeMessage) => void;
}

const reporter =
  (deps: Pick<InsertDeps<never>, "app" | "notify">) =>
  (outcome: AnnotationInsertOutcome): void => {
    const message = insertOutcomeMessage(deps.app, outcome);
    if (message !== null) deps.notify(message);
  };

function insertSlot<R>(
  deps: InsertDeps<R>,
  report: (outcome: AnnotationInsertOutcome) => void,
) {
  const latest = latestSlot(deps.run);
  const runner: InsertDeps<R> = { ...deps, run: latest.run };
  return {
    cancel: latest.interrupt,
    hold(start: (runner: InsertDeps<R>) => InsertFiber): InsertFiber {
      const fiber = start(runner);
      observeExit(fiber, { onSuccess: report });
      return fiber;
    },
  };
}

export function insertOutcomeMessage(
  app: App,
  outcome: AnnotationInsertOutcome,
): NoticeMessage | null {
  switch (outcome.kind) {
    case "unavailable":
      return m.annotation_suggest_unavailable();
    case "no-note":
      return m.annot_view_insert_no_note();
    case "source-unavailable":
      return m.annot_view_drag_unavailable();
    case "fallback":
      return outcome.landed ? m.annot_view_drag_unavailable() : null;
    case "inserted": {
      const { summary } = outcome;
      return summary.zotero || summary.unchecked || summary.unavailable
        ? m.excerpt_image_summary({
            ...summary,
            notRefreshed: summary.notRefreshed ?? 0,
          })
        : null;
    }
    case "profile-error": {
      const { diagnostic, message } = outcome.error;
      return diagnostic.code === "unknown-literature-note-profile"
        ? profileRecoveryNotice(app, diagnostic)
        : message;
    }
    case "failed":
      return m.annot_view_insert_failed();
    case "cancelled":
      return null;
  }
}

export function createInsertHandler<R>(deps: InsertDeps<R>) {
  const report = reporter(deps);
  const slot = insertSlot(deps, report);
  const { cancel } = slot;
  const insertInto = (
    annotation: AnnotationRecord,
    info: MarkdownFileInfo | null,
  ): InsertFiber | null => {
    cancel();
    const editor = info?.editor;
    const file = info?.file;
    if (!info || !file || !editor) {
      report({ kind: "no-note" });
      return null;
    }
    const snapshot = deps.snapshot(annotation);
    if (!snapshot.source || snapshot.sourceScope === null) {
      report({ kind: "source-unavailable" });
      return null;
    }
    return slot.hold((runner) =>
      startInsert(runner, {
        annotation,
        snapshot,
        notePath: file.path,
        capture: () =>
          captureInsertion({
            editor,
            info,
            isCurrent: () => {
              const current = insertionEditor(deps.app.workspace);
              return current?.editor === editor && current.file === info.file;
            },
            watchChanges: watchInsertionWorkspace(deps.app.workspace),
          }),
      }),
    );
  };
  const offer = () => {
    const info = insertionEditor(deps.app.workspace);
    const file = info?.file;
    const editor = info?.editor;
    if (!info || !file || !editor) return null;
    return (annotation: AnnotationRecord) => {
      const current = insertionEditor(deps.app.workspace);
      if (
        current?.file !== file ||
        current.editor !== editor ||
        info.file !== file ||
        info.editor !== editor
      )
        return null;
      return insertInto(annotation, info);
    };
  };
  const insert = (annotation: AnnotationRecord) =>
    insertInto(annotation, insertionEditor(deps.app.workspace));
  return Object.assign(insert, { cancel, offer });
}

interface ActiveDrag {
  cancel(): void;
}

export interface AnnotationDragStart {
  readonly dataTransfer: DataTransfer;
  readonly currentTarget: HTMLElement;
  preventDefault(): void;
}

export function createDragInsertHandler<R>(deps: InsertDeps<R>) {
  const report = reporter(deps);
  const slot = insertSlot(deps, report);
  let active: ActiveDrag | null = null;
  const cancel = () => {
    active?.cancel();
    slot.cancel();
  };
  const drag = (
    event: AnnotationDragStart,
    annotation: AnnotationRecord,
  ): void => {
    cancel();
    const snapshot = deps.snapshot(annotation);
    if (!snapshot.source || snapshot.sourceScope === null) {
      event.preventDefault();
      report({ kind: "source-unavailable" });
      return;
    }

    const request = nanoid();
    event.dataTransfer.dropEffect = "copy";
    event.dataTransfer.setData("text/plain", annotation.text ?? annotation.key);
    event.dataTransfer.setData(SOURCE_TAG, request);

    const { workspace } = deps.app;
    const win = event.currentTarget.win;
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      workspace.offref(dropRef);
      win.removeEventListener("dragend", onDragEnd);
      if (active === operation) active = null;
    };
    const operation: ActiveDrag = { cancel: cleanup };
    const onDragEnd = () => cleanup();
    // oxlint-disable-next-line obsidianmd/editor-drop-paste -- handles only this view's own drag payload
    const dropRef = workspace.on("editor-drop", (dropEvent, editor, info) => {
      if (dropEvent.dataTransfer?.getData(SOURCE_TAG) !== request) return;
      dropEvent.preventDefault();
      dropEvent.dataTransfer.dropEffect = "copy";
      cleanup();
      const file = info.file;
      if (!file) {
        report({ kind: "no-note" });
        return;
      }
      slot.hold((runner) =>
        insertDrop(runner, {
          annotation,
          snapshot,
          dropEvent,
          editor,
          info,
          file,
        }),
      );
    });
    active = operation;
    win.addEventListener("dragend", onDragEnd, { once: true });
  };
  return Object.assign(drag, { cancel });
}

function insertDrop<R>(
  deps: InsertDeps<R>,
  options: {
    annotation: AnnotationRecord;
    snapshot: AnnotationSnapshot;
    dropEvent: DragEvent;
    editor: Editor;
    info: MarkdownFileInfo;
    file: TFile;
  },
): InsertFiber {
  const { editor, info, file } = options;
  const position = editor.cm.posAtCoords(
    { x: options.dropEvent.clientX, y: options.dropEvent.clientY },
    false,
  );
  return startInsert(deps, {
    annotation: options.annotation,
    snapshot: options.snapshot,
    notePath: file.path,
    capture: () =>
      captureInsertion({
        editor,
        info,
        range: { from: position, to: position },
        isCurrent: () => info.file === file && info.editor === editor,
        watchChanges: watchInsertionWorkspace(deps.app.workspace),
      }),
  });
}
