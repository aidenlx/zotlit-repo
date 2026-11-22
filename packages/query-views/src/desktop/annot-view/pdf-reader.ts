import { Effect } from "effect";

import { obsidianAttachmentReader } from "@zotlit/annotations/desktop/attachment-open/obsidian-reader.ts";
import type { TargetReader } from "@zotlit/annotations/desktop/attachment-open/open-target.ts";
import type { ReaderOpenFailed } from "@zotlit/annotations/obsidian/pdf-reader/service.ts";
import { ZotlitPdfReader } from "@zotlit/annotations/obsidian/pdf-reader/service.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import type { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { activateAnnotView } from "./register.ts";

export const pdfReader: Effect.Effect<
  TargetReader<ReaderOpenFailed>,
  never,
  ObsidianApp | PluginSettings | ZotlitPdfReader | Vault
> = Effect.gen(function* () {
  const app = yield* ObsidianApp;
  const settings = yield* PluginSettings;
  const reader = yield* ZotlitPdfReader;
  return yield* obsidianAttachmentReader({
    open: (file, subpath, pane) => reader.open(file, subpath, pane),
    onOpened: Effect.flatMap(settings.current, (current) =>
      current["reader.focus-annot-view"]
        ? Effect.sync(() => void activateAnnotView(app))
        : Effect.void,
    ),
  });
});
