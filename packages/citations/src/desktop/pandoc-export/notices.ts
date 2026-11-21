// What the user reads when an export cannot start, or stops.

import type {
  BibliographySource,
  ExportFailure,
} from "#desktop/pandoc/export.ts";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { PackBinaryStatus } from "@zotlit/plugin-services/obsidian/managed-binary/pack-binary.ts";
import {
  openPackStatusPage,
  packStatusSentence,
} from "@zotlit/plugin-services/obsidian/managed-binary/pack-row.ts";

/**
 * The engine is the one prerequisite the command cannot supply itself: the
 * notice names the Resource Pack, states where the engine stands, and opens
 * the page of the plugin to install or update in the community plugin browser.
 */
export function engineMissingMessage(
  status: PackBinaryStatus,
): DocumentFragment {
  return BaseNotice.render((renderer) => {
    renderer
      .setTitle(m.notice_pandoc_export_engine_missing())
      .addText(packStatusSentence(status));
    renderer.addAction((button) => {
      button
        .setButtonText(m.settings_resource_pack_open())
        .setCta()
        .onClick(() => {
          openPackStatusPage(status);
        });
    });
  });
}

/**
 * Everything that stops an export: the conversion's own failures, the note's
 * own unusable Citation Presentation, which stops the run before the engine sees
 * it, plus the destination write, which happens after the engine has already
 * answered.
 */
export type ExportProblem =
  | ExportFailure
  | { kind: "document-style-invalid" }
  | { kind: "document-language-invalid" }
  | {
      kind: "document-profile-invalid";
      stamp: string;
      target: string;
      recover: () => void;
    }
  | { kind: "profile-style-invalid"; styleId: string }
  /** A style the vault or the dialog selected, by its name. */
  | { kind: "style-invalid"; style: string }
  | { kind: "destination-unwritable"; detail: string };

/** One message per failure arm, each naming the situation and its fix. */
export function exportFailureMessage(failure: ExportProblem): DocumentFragment {
  return BaseNotice.render((renderer) => {
    renderer.setTitle(m.notice_pandoc_export_failed());
    switch (failure.kind) {
      case "citation-intent":
        renderer.addList(
          m.pandoc_export_error_citation_intent(),
          failure.linkpaths,
        );
        break;
      case "database-unavailable":
        renderer.addText(
          m.pandoc_export_error_database({ dataDir: failure.dataDir }),
        );
        break;
      case "items-missing":
        renderer.addList(
          m.pandoc_export_error_items_missing(),
          failure.sources,
        );
        break;
      case "citation-keys-missing":
        renderer.addList(
          m.pandoc_export_error_citation_keys_missing(),
          failure.sources,
        );
        break;
      case "citation-keys-unknown":
        renderer.addList(
          m.pandoc_export_error_citekeys_unknown(),
          failure.citekeys,
        );
        break;
      case "citation-keys-ambiguous":
        renderer.addList(
          m.pandoc_export_error_citekeys_ambiguous(),
          failure.citekeys,
        );
        break;
      case "zotero-unreachable":
        renderer.addText(
          m.pandoc_export_error_zotero_unreachable({ port: failure.port }),
        );
        break;
      case "zotero-timeout":
        renderer.addText(
          m.pandoc_export_error_zotero_timeout({ seconds: failure.seconds }),
        );
        break;
      case "zotero-port-automatic":
        renderer.addText(
          m.pandoc_export_error_zotero_port_automatic({
            pref: failure.pref,
          }),
        );
        break;
      case "local-api-disabled":
        renderer.addText(
          m.pandoc_export_error_local_api({ pref: failure.pref }),
        );
        break;
      case "source-failed":
        renderer.addText(
          m.pandoc_export_error_source({
            source: sourceName(failure.source),
            detail: failure.detail,
          }),
        );
        break;
      case "engine":
        renderer.addText(
          m.pandoc_export_error_engine({ detail: failure.detail }),
        );
        break;
      case "document-style-invalid":
        renderer.addText(m.pandoc_export_error_document_style());
        break;
      case "document-language-invalid":
        renderer.addText(m.pandoc_export_error_document_language());
        break;
      case "document-profile-invalid":
        renderer.addText(
          m.notice_imported_note_profile_unknown({
            stamp: failure.stamp,
            target: failure.target,
          }),
        );
        renderer.addAction((button) => {
          button.setButtonText(m.profile_switch_recovery()).onClick(() => {
            failure.recover();
          });
        });
        break;
      case "profile-style-invalid":
        renderer.addText(
          m.pandoc_export_error_profile_style({ style: failure.styleId }),
        );
        break;
      case "style-invalid":
        renderer.addText(m.pandoc_export_error_style({ style: failure.style }));
        break;
      case "destination-unwritable":
        renderer.addText(
          m.pandoc_export_error_destination({ detail: failure.detail }),
        );
        break;
    }
  });
}

function sourceName(source: BibliographySource): string {
  return source === "better-bibtex"
    ? m.pandoc_export_source_better_bibtex()
    : m.pandoc_export_source_local_api();
}
