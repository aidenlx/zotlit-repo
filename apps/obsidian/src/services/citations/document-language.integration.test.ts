import { describe, expect, it } from "vitest";

import * as m from "@zotlit/plugin-messages/messages.ts";

import {
  EXPORT_NOTE,
  openCitationVault,
  TIMEOUT,
} from "@/services/citations/__fixtures__/citation-surfaces.ts";

const VAULT_STYLE_ID = "http://www.zotero.org/styles/vault-localized";
const NOTE_STYLE_ID = "http://www.zotero.org/styles/note-numbered";

const EDITOR = { "en-US": "editor", "de-DE": "Herausgeber" };

const VAULT_WORD = "vault";

const MARKER = "[1]";

const VAULT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0" default-locale="de-DE">
  <info>
    <title>Vault localized</title>
    <id>${VAULT_STYLE_ID}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation>
    <layout>
      <text term="editor" form="long"/>
      <text value="${VAULT_WORD}" prefix=" "/>
    </layout>
  </citation>
  <bibliography>
    <layout>
      <text term="editor" form="long"/>
      <text value="${VAULT_WORD}" prefix=" "/>
    </layout>
  </bibliography>
</style>`;

const NOTE_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Note numbered</title>
    <id>${NOTE_STYLE_ID}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout prefix="[" suffix="]"><text variable="citation-number"/></layout></citation>
  <bibliography second-field-align="flush">
    <layout>
      <text variable="citation-number" prefix="[" suffix="]"/>
      <text term="editor" form="long" prefix=" "/>
    </layout>
  </bibliography>
</style>`;

const STYLES = {
  "vault-localized.csl": VAULT_STYLE,
  "note-numbered.csl": NOTE_STYLE,
};

function openVault({
  locale = null,
  documentStyle,
  documentLanguage,
}: {
  locale?: string | null;
  documentStyle?: unknown;
  documentLanguage?: unknown;
} = {}) {
  return openCitationVault({
    styles: STYLES,
    settings: {
      "citation.references-style": VAULT_STYLE_ID,
      "citation.locale": locale,
    },
    documentStyle,
    documentLanguage,
  });
}

describe("Document Language", { timeout: TIMEOUT }, () => {
  it("overrides the vault Citation Locale on every surface", async () => {
    await using vault = await openVault({
      locale: "en-US",
      documentLanguage: "de-DE",
    });

    await expect(vault.citationText()).resolves.toBe(
      `${EDITOR["de-DE"]} ${VAULT_WORD}`,
    );
    const sidebar = await vault.sidebarText();
    expect(sidebar).toContain(EDITOR["de-DE"]);
    expect(sidebar).not.toContain(EDITOR["en-US"]);
    await expect(vault.popoverText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );

    const exported = await vault.exportNote();
    expect(exported.html).toContain(EDITOR["de-DE"]);
    expect(exported.html).toMatch(/<html[^>]*lang="de-DE"/);
    expect(exported.html).toMatch(/<h1[^>]*>Literatur<\/h1>/);
  });

  it("carries a note's own style and language together", async () => {
    await using vault = await openVault({
      locale: "en-US",
      documentStyle: NOTE_STYLE_ID,
      documentLanguage: "de-DE",
    });

    await expect(vault.citationText()).resolves.toBe(MARKER);
    const sidebar = await vault.sidebarText();
    expect(sidebar).toContain(MARKER);
    expect(sidebar).toContain(EDITOR["de-DE"]);
    expect(sidebar).not.toContain(VAULT_WORD);
    const copied = await vault.copiedBibliography();
    expect(copied).toContain(MARKER);
    expect(copied).toContain(EDITOR["de-DE"]);

    const exported = await vault.exportNote();
    expect(exported.openedOn).toBe(NOTE_STYLE_ID);
    expect(exported.html).toContain(MARKER);
    expect(exported.html).toContain(EDITOR["de-DE"]);
    expect(exported.html).toMatch(/<html[^>]*lang="de-DE"/);
    expect(vault.vaultStyleMissing()).toBe(null);
  });

  it.each([
    ["is written as a POSIX locale", "de_DE"],
    ["carries no language tag at all", ["de-DE"]],
  ])("stops the note where its language %s", async (_name, language) => {
    await using vault = await openVault({
      locale: "en-US",
      documentLanguage: language,
    });

    await expect(vault.citationText()).resolves.toBe(undefined);
    const sidebar = await vault.minimalSidebarText();
    expect(sidebar).toContain(m.references_document_language_failed_title());
    expect(sidebar).not.toContain(EDITOR["en-US"]);
    expect(sidebar).not.toContain(EDITOR["de-DE"]);
    expect(vault.copyOffered()).toBe(false);
    await expect(vault.exportNote()).resolves.toMatchObject({ html: null });
    expect(vault.vaultStyleMissing()).toBe(null);
  });

  it("moves every surface together when the note's language changes", async () => {
    await using vault = await openVault({ documentStyle: NOTE_STYLE_ID });
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["en-US"]);
    using popover = vault.showPopover();
    const shown = await popover.text();
    expect(shown).toContain(EDITOR["en-US"]);

    await vault.setNoteLanguage("de-DE");

    expect(vault.copyOffered()).toBe(false);
    await expect(vault.citationText()).resolves.toBe(MARKER);
    const sidebar = await vault.sidebarText();
    expect(sidebar).toContain(MARKER);
    expect(sidebar).toContain(EDITOR["de-DE"]);
    await expect(popover.text(shown)).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );
  });

  it("moves every surface with the one update the action writes", async () => {
    await using vault = await openVault({ locale: "en-US" });
    await expect(vault.citationText()).resolves.toBe(
      `${EDITOR["en-US"]} ${VAULT_WORD}`,
    );

    await vault.setPresentation({ styleId: NOTE_STYLE_ID, language: "de-DE" });

    await expect(vault.citationText()).resolves.toBe(MARKER);
    const sidebar = await vault.sidebarText();
    expect(sidebar).toContain(MARKER);
    expect(sidebar).toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );
    const exported = await vault.exportNote();
    expect(exported.openedOn).toBe(NOTE_STYLE_ID);
    expect(exported.html).toContain(MARKER);
    expect(exported.html).toMatch(/<html[^>]*lang="de-DE"/);

    await vault.setPresentation({ styleId: null, language: null });

    await expect(vault.citationText()).resolves.toBe(
      `${EDITOR["en-US"]} ${VAULT_WORD}`,
    );
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["en-US"]);
    expect(vault.noteStyle(EXPORT_NOTE)).toBe(undefined);
  });
});
