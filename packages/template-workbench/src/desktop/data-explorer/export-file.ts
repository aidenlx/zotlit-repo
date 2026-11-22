import type { TemplateRoot } from "#obsidian/workbench-ui/index.tsx";
import { Effect } from "effect";

import type { TemplateDataLoadResult } from "@zotlit/notes/desktop/template/data.ts";
import { exportTimestamp, saveFile } from "@zotlit/obsidian-kit/file-save.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { buildTemplateDataExport } from "#core/data-explorer/export.ts";
import { getSampleItem } from "#core/editor/selection-data.ts";

export interface TemplateDataExportTarget {
  indexedKey: string;
  root: TemplateRoot;
}

export function exportTarget(
  item: { readonly id: string } | null,
  root: TemplateRoot,
  annotation: string | null,
): TemplateDataExportTarget | null {
  if (!item || getSampleItem(item.id)) return null;
  if (root !== "annotation") return { indexedKey: item.id, root };
  return annotation
    ? { indexedKey: annotation, root }
    : { indexedKey: item.id, root: "note" };
}

export function saveTemplateDataExport(
  result: TemplateDataLoadResult,
  {
    indexedKey,
    root,
    pluginVersion,
  }: TemplateDataExportTarget & { pluginVersion: string },
): void {
  if (result.kind !== "data") {
    Effect.runSyncWith(logServices)(
      Effect.logError(
        "No template data to export for {indexedKey}: {reason}",
      ).pipe(
        Effect.annotateLogs({
          indexedKey,
          root,
          reason: result.kind,
        }),
        withLogCategory("views", "template-data-explorer"),
      ),
    );
    new BaseNotice(m.template_data_explorer_export_failed());
    return;
  }
  const { filename, json } = buildTemplateDataExport({
    root: result.data,
    contractRoot: root,
    indexedKey,
    pluginVersion,
    timestamp: exportTimestamp(),
  });
  saveFile(new Blob([json], { type: "application/json" }), filename);
  Effect.runSyncWith(logServices)(
    Effect.logDebug("Exported template data to {filename}").pipe(
      Effect.annotateLogs({ filename, root }),
      withLogCategory("views", "template-data-explorer"),
    ),
  );
}

export function failTemplateDataExport(
  { indexedKey, root }: TemplateDataExportTarget,
  error: unknown,
): void {
  Effect.runSyncWith(logServices)(
    Effect.logError("Failed to export template data for {indexedKey}").pipe(
      Effect.annotateLogs({
        indexedKey,
        root,
        error,
      }),
      withLogCategory("views", "template-data-explorer"),
    ),
  );
  new BaseNotice(m.template_data_explorer_export_failed());
}
