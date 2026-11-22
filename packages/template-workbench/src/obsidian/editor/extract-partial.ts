import type { SuggestionSource } from "#core/language/index.ts";
import type { WorkbenchRunner } from "#obsidian/workbench-ui/index.tsx";
import { isolateHistory } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Effect } from "effect";
import { Menu } from "obsidian";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { observeExit } from "@zotlit/plugin-kernel/fiber-exit.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { TemplateLanguage } from "@zotlit/templates/facade";

export type ExtractPartial = (source: string) => Effect.Effect<string | null>;

export function partialCall(name: string, language: TemplateLanguage): string {
  return language === "eta"
    ? `<%~ include("${name}", zt) %>`
    : `{% render "${name}" with zt as zt %}`;
}

export function extractPartialMenu(
  read: SuggestionSource,
  extract: ExtractPartial,
  run: WorkbenchRunner,
): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      const { from, to } = view.state.selection.main;
      if (from === to || view.state.readOnly) return false;
      const config = read(from);
      if (
        !config ||
        config.mode === "expression" ||
        config.language === "json-e"
      )
        return false;
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(m.template_workbench_cut())
          .setIcon("scissors")
          .onClick(() => void cutSelection(view)),
      );
      menu.addItem((item) =>
        item
          .setTitle(m.template_workbench_copy())
          .setIcon("copy")
          .onClick(() => void copySelection(view)),
      );
      menu.addItem((item) =>
        item
          .setTitle(m.template_workbench_paste())
          .setIcon("clipboard-paste")
          .onClick(() => void pasteOverSelection(view)),
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(m.template_workbench_extract_partial())
          .setIcon("file-output")
          .onClick(() =>
            observeExit(run(extractSelection(view, extract)), {
              onSuccess: reportExtraction,
            }),
          ),
      );
      menu.showAtMouseEvent(event);
      event.preventDefault();
      return true;
    },
  });
}

async function copySelection(view: EditorView): Promise<void> {
  const { from, to } = view.state.selection.main;
  await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
}

async function cutSelection(view: EditorView): Promise<void> {
  const { from, to } = view.state.selection.main;
  await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
  view.dispatch({
    changes: { from, to },
    selection: { anchor: from },
    userEvent: "delete.cut",
  });
}

async function pasteOverSelection(view: EditorView): Promise<void> {
  const insert = await navigator.clipboard.readText();
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.paste",
  });
}

export type ExtractOutcome = "extracted" | "dismissed" | "stale";

export const extractSelection = (
  view: EditorView,
  extract: ExtractPartial,
): Effect.Effect<ExtractOutcome> =>
  Effect.suspend(() => {
    const { from, to } = view.state.selection.main;
    const source = view.state.doc.toString();
    return extract(source.slice(from, to)).pipe(
      Effect.flatMap((call) => {
        if (call === null) return Effect.succeed("dismissed" as const);
        if (view.state.doc.toString() !== source)
          return Effect.logDebug(
            "Dropped an extraction onto a changed document",
          ).pipe(Effect.annotateLogs({ call }), Effect.as("stale" as const));
        view.dispatch({
          changes: { from, to, insert: call },
          selection: { anchor: from + call.length },
          annotations: isolateHistory.of("full"),
          userEvent: "input.extract-partial",
        });
        return Effect.succeed("extracted" as const);
      }),
      withLogCategory("template-workbench"),
    );
  });

function reportExtraction(outcome: ExtractOutcome): void {
  if (outcome === "stale") new BaseNotice(m.notice_partial_extract_stale());
}
