import { Effect, Schema } from "effect";
import type { App, Plugin, TFile } from "obsidian";
// The Set citation presentation action: its command-palette entry, its place in
// the active note's More options menu, and the update a confirmed dialog writes.

import { awaitModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import { Notifier, reportOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import type { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { FileMenuSegment } from "@/services/file-menu.ts";
import type { PluginSettings } from "@/services/settings/service.ts";
import type { ZoteroPref } from "@/services/zotero-pref/service.ts";
import type { StyleDropdownOptions } from "@/views/style-dropdown.ts";

import { openCitationPresentationModal } from "./modal.ts";
import type { CitationPresentationChoice } from "./presentation.ts";
import {
  applyCitationPresentation,
  declaredPresentation,
} from "./presentation.ts";

class CitationPresentationWriteError extends Schema.TaggedError<
  CitationPresentationWriteError,
  { readonly brand: unique symbol }
>()("CitationPresentationWriteError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface CitationPresentationDeps {
  app: App;
  fileSystem: StyleDropdownOptions["fileSystem"];
  /** Where the installed styles the dialog lists are read from. */
  zoteroPref: Pick<ZoteroPref["Service"], "current">;
  /** The vault selections a note inherits where it names none of its own. */
  settings: Pick<PluginSettings["Service"], "current">;
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">;
  workspace: Pick<Workspace["Service"], "getActiveFile">;
  metadataCache: Pick<MetadataCache["Service"], "fileCache">;
  notifier: Notifier["Service"];
}

/**
 * Every note is presented one way or another, so the action asks for nothing of
 * the note but that it be a Markdown note on screen.
 */
export function registerCitationPresentation(
  plugin: Pick<Plugin, "addCommand">,
  deps: CitationPresentationDeps,
): void {
  plugin.addCommand({
    id: "set-citation-presentation",
    name: m.command_set_citation_presentation_name(),
    checkCallback: (checking) => {
      const file = deps.bridge.runSync(deps.workspace.getActiveFile);
      if (file?.extension !== "md") return false;
      if (checking) return true;
      void setCitationPresentation(file, deps);
      return true;
    },
  });
}

/**
 * The action on the note's own More options menu, which is where the note on
 * screen is configured from; every other file menu leaves it to the palette.
 */
export function citationPresentationFileMenu(
  deps: CitationPresentationDeps,
): FileMenuSegment {
  return (menu, { file, source }) => {
    if (source !== "more-options" || file.extension !== "md") return;
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.action)
        .setTitle(m.command_set_citation_presentation_name())
        .setIcon("quote")
        .onClick(() => void setCitationPresentation(file, deps)),
    );
  };
}

/** One scoped run reads the selections, waits for confirmation, and writes the note. */
export async function setCitationPresentation(
  file: TFile,
  deps: CitationPresentationDeps,
): Promise<void> {
  const exit = await deps.bridge.runPromiseExit(
    choosePresentation(file, deps).pipe(
      Effect.provideService(Notifier, deps.notifier),
    ),
  );
  valueOr(exit, undefined);
}

const choosePresentation = Effect.fn("CitationPresentation.choose")(function* (
  file: TFile,
  {
    app,
    zoteroPref,
    settings,
    bridge,
    fileSystem,
    metadataCache,
  }: CitationPresentationDeps,
) {
  const vault = yield* settings.current;
  const { dataDir } = yield* zoteroPref.current;
  const declared = declaredPresentation(yield* metadataCache.fileCache(file));
  const choice = yield* awaitModal<CitationPresentationChoice | null>(
    (resolve) =>
      openCitationPresentationModal(
        app,
        {
          dataDir,
          fileSystem,
          bridge,
          vaultStyleId:
            vault["note.default-profile"].bindings["citation.references-style"],
          vaultLocale: vault["citation.locale"] ?? "",
          declared,
        },
        resolve,
      ),
  );
  if (!choice) return;
  // Once confirmed, the save and its known outcome finish before unload.
  yield* reportOutcome(
    Effect.tryPromise({
      try: () => applyCitationPresentation(app, file, choice),
      catch: (cause) =>
        new CitationPresentationWriteError({ path: file.path, cause }),
    }),
    {
      success: () => undefined,
      error: () => m.notice_citation_presentation_failed(),
    },
  ).pipe(Effect.uninterruptible);
});
