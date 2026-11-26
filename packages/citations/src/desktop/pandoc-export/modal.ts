import type { InstalledCslStyle } from "#core/pandoc/csl-style.ts";
import type { StyleDropdownOptions } from "#desktop/pandoc/style-dropdown.ts";
import type { StyleSource } from "#obsidian/pandoc/document-presentation.ts";
import type { DocumentFormat } from "#obsidian/pandoc/engine.ts";
import { Effect } from "effect";
import { homedir } from "node:os";
import { extname } from "node:path";
import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";

import { requireDialog } from "@zotlit/obsidian-desktop/require.ts";
import type { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import type { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { exportDestinationLocation } from "./destination.ts";

import {
  citationStyleLabel,
  referencesStyleOptions,
  STYLE_DEFAULT,
} from "#core/pandoc/citation-style.ts";
import { addStyleDropdown } from "#desktop/pandoc/style-dropdown.ts";

const FORMATS: readonly DocumentFormat[] = ["docx", "html"];

const KNOWN_EXTENSIONS = new Set([".md", ".docx", ".html"]);

export interface PandocExportChoices {
  format: DocumentFormat;
  styleId: string | null;
  destination: string;
}

export interface PandocExportModalOptions extends Pick<
  StyleDropdownOptions,
  "fileSystem" | "bridge"
> {
  dataDir: string;
  referencesStyleId: string | null;
  styleSource: StyleSource;
  notePath: string;
  vault: Pick<VaultDisk["Service"], "basePath"> &
    Pick<ObsidianEnv["Service"], "vaultName">;
}

export function openPandocExportModal(
  app: App,
  {
    dataDir,
    fileSystem,
    bridge,
    referencesStyleId,
    styleSource,
    notePath,
    vault,
  }: PandocExportModalOptions,
  resolve: (choices: PandocExportChoices | null) => void,
): Modal {
  let format: DocumentFormat = "docx";
  const noteStyleId = referencesStyleId ?? STYLE_DEFAULT;
  let styleId = noteStyleId;
  let installed: readonly InstalledCslStyle[] = [];
  const titleOf = (id: string): string => citationStyleLabel(id, installed);
  let stem = stemOf(notePath);
  const destination = (): string => `${stem}.${format}`;

  const modal = new Modal(app);
  modal.setTitle(m.pandoc_export_title());
  modal.contentEl.addClass("zt-root");

  new Setting(modal.contentEl)
    .setName(m.pandoc_export_format_name())
    .setDesc(m.pandoc_export_format_desc())
    .addDropdown((dropdown) => {
      for (const value of FORMATS)
        dropdown.addOption(value, formatLabel(value));
      dropdown.setValue(format);
      dropdown.onChange((value) => {
        format = value as DocumentFormat;
        showDestination();
      });
    });

  const styleSetting = new Setting(modal.contentEl).setName(
    m.pandoc_export_style_name(),
  );
  const showStyleSource = (): void => {
    styleSetting.setDesc(
      styleId === noteStyleId
        ? sourceText(styleSource)
        : m.pandoc_export_style_changed({ style: titleOf(noteStyleId) }),
    );
  };
  showStyleSource();
  addStyleDropdown(styleSetting, {
    dataDir,
    fileSystem,
    bridge,
    value: styleId,
    options: (styles, selected) => {
      installed = styles;
      return referencesStyleOptions(styles, selected);
    },
    onChange: (value) => {
      styleId = value;
      showStyleSource();
    },
  });

  const destinationSetting = new Setting(modal.contentEl)
    .setName(m.pandoc_export_destination_name())
    .addButton((button) =>
      button
        .setButtonText(m.pandoc_export_destination_browse())
        .onClick(() => void browse()),
    );
  const showDestination = (): void => {
    const location = exportDestinationLocation(destination(), {
      vaultPath: vault.basePath,
      homePath: homedir(),
    });
    destinationSetting.setDesc(
      location.kind === "vault"
        ? m.pandoc_export_destination_in_vault({
            path: location.path,
            vault: vault.vaultName,
          })
        : location.path,
    );
  };
  showDestination();

  new Setting(modal.contentEl)
    .addButton((button) =>
      button.setButtonText(m.modal_cancel()).onClick(() => modal.close()),
    )
    .addButton((button) =>
      button
        .setButtonText(m.pandoc_export_confirm())
        .setCta()
        .onClick(() => {
          resolve({
            format,
            styleId: styleId === STYLE_DEFAULT ? null : styleId,
            destination: destination(),
          });
          modal.close();
        }),
    );

  modal.setCloseCallback(() => resolve(null));
  modal.open();
  return modal;

  async function browse(): Promise<void> {
    try {
      const picked = await requireDialog().showSaveDialog({
        title: m.pandoc_export_destination_title(),
        defaultPath: destination(),
        filters: [{ name: formatLabel(format), extensions: [format] }],
      });
      if (picked.canceled || !picked.filePath) return;
      stem = stemOf(picked.filePath);
      showDestination();
    } catch (error) {
      Effect.runSyncWith(logServices)(
        Effect.logError("Failed to open the export destination dialog").pipe(
          Effect.annotateLogs({ error }),
          withLogCategory("views", "pandoc-export"),
        ),
      );
    }
  }
}

function sourceText(source: StyleSource): string {
  switch (source.kind) {
    case "note":
      return m.pandoc_export_style_from_note();
    case "profile":
      return m.pandoc_export_style_from_profile({
        profile: source.label ?? m.settings_profile_default_name(),
      });
    case "vault":
      return m.pandoc_export_style_from_vault();
  }
}

function formatLabel(format: DocumentFormat): string {
  return format === "docx"
    ? m.pandoc_export_format_docx()
    : m.pandoc_export_format_html();
}

function stemOf(path: string): string {
  const ext = extname(path).toLowerCase();
  return KNOWN_EXTENSIONS.has(ext) ? path.slice(0, -ext.length) : path;
}
