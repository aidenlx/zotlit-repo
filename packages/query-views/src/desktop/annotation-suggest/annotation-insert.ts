import type { App, MarkdownFileInfo } from "obsidian";

import { captureInsertion } from "@zotlit/annotations/obsidian/annot-view/async-insert.ts";
import { insertOutcomeMessage } from "@zotlit/annotations/obsidian/annot-view/drag-insert.ts";
import { startInsert } from "@zotlit/annotations/obsidian/annot-view/insert-run.ts";
import type {
  InsertFiber,
  InsertRunner,
} from "@zotlit/annotations/obsidian/annot-view/insert-run.ts";
import { observeExit } from "@zotlit/plugin-kernel/fiber-exit.ts";

import type { AnnotationHit } from "./annotation-search.ts";

export interface AnnotationInsertDeps {
  app: App;
  workspace: Pick<App["workspace"], "on" | "offref">;
  runner: InsertRunner<never>;
  notify: (message: string | DocumentFragment) => void;
}

export function insertAnnotation(
  deps: AnnotationInsertDeps,
  {
    hit,
    info,
    isCurrent,
    range,
  }: {
    hit: AnnotationHit;
    info: MarkdownFileInfo;
    isCurrent: () => boolean;
    range: { from: number; to: number };
  },
): InsertFiber | undefined {
  const { editor, file } = info;
  if (!editor || !file) return;
  const fiber = startInsert(deps.runner, {
    hit,
    notePath: file.path,
    placement: { replacesTrigger: true },
    capture: () =>
      captureInsertion({
        editor,
        info,
        isCurrent,
        range,
        workspace: deps.workspace,
      }),
  });
  observeExit(fiber, {
    onSuccess: (outcome) => {
      const message = insertOutcomeMessage(deps.app, outcome);
      if (message !== null) deps.notify(message);
    },
  });
  return fiber;
}
