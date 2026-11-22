import type { StyleDropdownOptions } from "#desktop/pandoc/style-dropdown.ts";
import type {
  CitationPresentationChoice,
  DeclaredPresentation,
} from "#obsidian/citation-presentation/presentation.ts";
import { Modal, Setting } from "obsidian";
import type { App, TextComponent } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";

import { citationLocaleError } from "#core/citation-index/settings.ts";
import { addStyleDropdown } from "#desktop/pandoc/style-dropdown.ts";
import {
  STYLE_INHERITED,
  stylePickerOptions,
} from "#obsidian/citation-presentation/presentation.ts";

export interface CitationPresentationModalOptions extends Pick<
  StyleDropdownOptions,
  "fileSystem" | "bridge"
> {
  dataDir: string;
  vaultStyleId: string | null;
  vaultLocale: string;
  declared: DeclaredPresentation;
}

export function openCitationPresentationModal(
  app: App,
  {
    dataDir,
    fileSystem,
    bridge,
    vaultStyleId,
    vaultLocale,
    declared,
  }: CitationPresentationModalOptions,
  resolve: (choice: CitationPresentationChoice | null) => void,
): Modal {
  let styleId = declared.styleId;
  let languageInput: TextComponent;

  const modal = new Modal(app);
  modal.setTitle(m.citation_presentation_title());
  modal.contentEl.addClass("zt-root");

  addStyleDropdown(
    new Setting(modal.contentEl)
      .setName(m.citation_presentation_style_name())
      .setDesc(m.citation_presentation_style_desc()),
    {
      dataDir,
      fileSystem,
      bridge,
      value: styleId ?? STYLE_INHERITED,
      options: (styles, selected) =>
        stylePickerOptions(styles, {
          selected: asStyleId(selected),
          vaultStyleId,
        }),
      onChange: (value) => {
        styleId = asStyleId(value);
      },
    },
  );

  new Setting(modal.contentEl)
    .setName(m.citation_presentation_language_name())
    .setDesc(m.citation_presentation_language_desc())
    .addText((text) => {
      languageInput = text;
      text.setPlaceholder(vaultLocale || m.settings_citation_locale_default());
      text.setValue(declared.language);
      text.onChange(() => text.inputEl.setCustomValidity(""));
    })
    .addExtraButton((button) =>
      button
        .setIcon("rotate-ccw")
        .setTooltip(m.citation_presentation_language_reset())
        .onClick(() => {
          languageInput.setValue("");
          languageInput.inputEl.setCustomValidity("");
        }),
    );

  new Setting(modal.contentEl)
    .addButton((button) =>
      button.setButtonText(m.modal_cancel()).onClick(() => modal.close()),
    )
    .addButton((button) =>
      button
        .setButtonText(m.citation_presentation_confirm())
        .setCta()
        .onClick(() => submit()),
    );

  modal.setCloseCallback(() => resolve(null));
  modal.open();
  return modal;

  function submit(): void {
    const language = languageInput.getValue().trim();
    const invalid = citationLocaleError(language);
    if (invalid) {
      languageInput.inputEl.setCustomValidity(invalid);
      languageInput.inputEl.reportValidity();
      return;
    }
    resolve({ styleId, language: language || null });
    modal.close();
  }
}

function asStyleId(value: string): string | null {
  return value === STYLE_INHERITED ? null : value;
}
