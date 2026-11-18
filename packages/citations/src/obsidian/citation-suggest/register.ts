import type { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import type { CitationIndex } from "#obsidian/citation-index/service.ts";
import type { App, Plugin } from "obsidian";

import type { CitationVariant, CiteRef } from "@zotlit/db";

import "./style.css";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ItemLookupHandle } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";

import { CitationEditorSuggest } from "./editor-suggest.ts";
import { InsertCitationModal } from "./insert-modal.ts";

/**
 * What the Citation Template answers for one insert: the rendered Citation,
 * the message of an inert Citation Template, or `null` while the templates
 * load.
 */
export type CitationTemplateAnswer = string | { readonly inert: string } | null;

/** The Citation Template, which the notes feature renders. */
export interface CitationTemplate {
  renderCitation(
    citations: readonly CiteRef[],
    variant: CitationVariant,
  ): CitationTemplateAnswer;
}

export interface CitationSuggestDeps {
  app: App;
  lookup: ItemLookupHandle;
  citationTemplate: CitationTemplate;
  settings: Pick<PluginSettings["Service"], "current">;
  bridge: Pick<EffectBridge, "runSync" | "runPromise" | "runPromiseExit">;
  /** Says whether the Citation Key of a chosen Item names several Items, and
   *  whether the snapshot that answers that has resolved at all yet. */
  citationLookup: Pick<CitationLookup["Service"], "read" | "current">;
  citationIndex: Pick<CitationIndex["Service"], "getDocumentCitationSet">;
  useLedger: Pick<UseLedger["Service"], "record">;
}

export function registerCitationSuggest(
  plugin: Pick<Plugin, "registerEditorSuggest" | "addCommand">,
  deps: CitationSuggestDeps,
): void {
  plugin.registerEditorSuggest(new CitationEditorSuggest(deps));
  plugin.addCommand({
    id: "insert-citation",
    name: m.command_insert_citation_name(),
    editorCallback: (editor, ctx) => {
      new InsertCitationModal(deps, editor, ctx.file).open();
    },
  });
}
