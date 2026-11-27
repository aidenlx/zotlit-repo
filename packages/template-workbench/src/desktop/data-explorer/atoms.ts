import { Cause, Effect } from "effect";

import { TemplateDataReads } from "@zotlit/notes/desktop/template/data-reads.ts";
import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";

import type { TemplateDataExportTarget } from "./export-file.ts";
import {
  failTemplateDataExport,
  saveTemplateDataExport,
} from "./export-file.ts";

export const makeExportTemplateDataCommand = () =>
  viewRuntime.fn(
    (target: TemplateDataExportTarget & { readonly pluginVersion: string }) =>
      Effect.gen(function* () {
        const result = yield* (yield* TemplateDataReads).read(
          target.indexedKey,
          target.root,
        );
        yield* Effect.sync(() => saveTemplateDataExport(result, target));
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            failTemplateDataExport(target, Cause.squash(cause)),
          ),
        ),
      ),
  );
