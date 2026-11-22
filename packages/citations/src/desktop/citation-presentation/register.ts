import type { StyleDropdownOptions } from "#desktop/pandoc/style-dropdown.ts";
import type { CitationPresentationChoice } from "#obsidian/citation-presentation/presentation.ts";
import type { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";
import { Effect, Schema } from "effect";
import type { App, Plugin, TFile } from "obsidian";

import { awaitModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import { Notifier, reportOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import type { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { FileMenuSegment } from "@zotlit/plugin-services/obsidian/file-menu.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { openCitationPresentationModal } from "./modal.ts";

import {
  applyCitationPresentation,
  declaredPresentation,
} from "#obsidian/citation-presentation/presentation.ts";

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
  zoteroPref: Pick<ZoteroPref["Service"], "current">;
  settings: Pick<PluginSettings["Service"], "current">;
  profiles: Pick<ProfileStyles["Service"], "vaultStyleId">;
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">;
  workspace: Pick<Workspace["Service"], "getActiveFile">;
  metadataCache: Pick<MetadataCache["Service"], "fileCache">;
  notifier: Notifier["Service"];
}

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
    profiles,
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
          vaultStyleId: profiles.vaultStyleId(vault),
          vaultLocale: vault["citation.locale"] ?? "",
          declared,
        },
        resolve,
      ),
  );
  if (!choice) return;
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
