import type {
  BibliographySource,
  ExportFailure,
} from "#desktop/pandoc/export.ts";

import { noticeList } from "@zotlit/obsidian-kit/notice.ts";
import type { NoticeContent } from "@zotlit/obsidian-kit/notice.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  openPackStatusPage,
  packStatusSentence,
} from "@zotlit/plugin-services/obsidian/managed-binary/pack-row.ts";
import type { PackBinaryStatus } from "@zotlit/resource-pack/status.ts";

export function engineMissingMessage(
  status: PackBinaryStatus,
  readerId: string,
): NoticeContent {
  return {
    title: m.notice_pandoc_export_engine_missing(),
    lines: [packStatusSentence(status)],
    actions: [
      {
        label: m.settings_resource_pack_open(),
        run: () => {
          openPackStatusPage(status, readerId);
        },
      },
    ],
  };
}

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
  | { kind: "style-invalid"; style: string }
  | { kind: "destination-unwritable"; detail: string };

export function exportFailureMessage(failure: ExportProblem): NoticeContent {
  const title = m.notice_pandoc_export_failed();
  switch (failure.kind) {
    case "citation-intent":
      return {
        title,
        lines: noticeList(
          m.pandoc_export_error_citation_intent(),
          failure.linkpaths,
        ),
      };
    case "database-unavailable":
      return {
        title,
        lines: [m.pandoc_export_error_database({ dataDir: failure.dataDir })],
      };
    case "items-missing":
      return {
        title,
        lines: noticeList(
          m.pandoc_export_error_items_missing(),
          failure.sources,
        ),
      };
    case "citation-keys-missing":
      return {
        title,
        lines: noticeList(
          m.pandoc_export_error_citation_keys_missing(),
          failure.sources,
        ),
      };
    case "citation-keys-unknown":
      return {
        title,
        lines: noticeList(
          m.pandoc_export_error_citekeys_unknown(),
          failure.citekeys,
        ),
      };
    case "citation-keys-ambiguous":
      return {
        title,
        lines: noticeList(
          m.pandoc_export_error_citekeys_ambiguous(),
          failure.citekeys,
        ),
      };
    case "zotero-unreachable":
      return {
        title,
        lines: [
          m.pandoc_export_error_zotero_unreachable({ port: failure.port }),
        ],
      };
    case "zotero-timeout":
      return {
        title,
        lines: [
          m.pandoc_export_error_zotero_timeout({ seconds: failure.seconds }),
        ],
      };
    case "zotero-port-automatic":
      return {
        title,
        lines: [
          m.pandoc_export_error_zotero_port_automatic({ pref: failure.pref }),
        ],
      };
    case "local-api-disabled":
      return {
        title,
        lines: [m.pandoc_export_error_local_api({ pref: failure.pref })],
      };
    case "source-failed":
      return {
        title,
        lines: [
          m.pandoc_export_error_source({
            source: sourceName(failure.source),
            detail: failure.detail,
          }),
        ],
      };
    case "engine":
      return {
        title,
        lines: [m.pandoc_export_error_engine({ detail: failure.detail })],
      };
    case "document-style-invalid":
      return { title, lines: [m.pandoc_export_error_document_style()] };
    case "document-language-invalid":
      return { title, lines: [m.pandoc_export_error_document_language()] };
    case "document-profile-invalid":
      return {
        title,
        lines: [
          m.notice_imported_note_profile_unknown({
            stamp: failure.stamp,
            target: failure.target,
          }),
        ],
        actions: [
          {
            label: m.profile_switch_recovery(),
            run: () => {
              failure.recover();
            },
          },
        ],
      };
    case "profile-style-invalid":
      return {
        title,
        lines: [
          m.pandoc_export_error_profile_style({ style: failure.styleId }),
        ],
      };
    case "style-invalid":
      return {
        title,
        lines: [m.pandoc_export_error_style({ style: failure.style })],
      };
    case "destination-unwritable":
      return {
        title,
        lines: [m.pandoc_export_error_destination({ detail: failure.detail })],
      };
  }
}

function sourceName(source: BibliographySource): string {
  return source === "better-bibtex"
    ? m.pandoc_export_source_better_bibtex()
    : m.pandoc_export_source_local_api();
}
