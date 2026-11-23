import { describe, expect, it } from "vitest";

import type { ProfileId } from "@zotlit/obsidian-kit/profile-stamp.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import {
  EXPORT_BODY,
  EXPORT_NOTE,
  openCitationVault,
  SECOND_CITATION_KEY,
  TIMEOUT,
} from "@/services/citations/__fixtures__/citation-surfaces.ts";

const VAULT_STYLE_ID = "http://www.zotero.org/styles/vault-prose";
const NOTE_STYLE_ID = "http://www.zotero.org/styles/note-numbered";
const PROFILE_ID = "Aa1Bb2Cc3Dd4" as ProfileId;
const UNINSTALLED_STYLE_ID = "http://www.zotero.org/styles/uninstalled";

const VAULT_WORD = "prose";
const NOTE_WORD = "numbered";

const MARKER = "[1]";
const SECOND_MARKER = "[2]";

const VAULT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Vault prose</title>
    <id>${VAULT_STYLE_ID}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text value="${VAULT_WORD}"/></layout></citation>
  <bibliography><layout><text value="${VAULT_WORD}"/></layout></bibliography>
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
      <text value="${NOTE_WORD}" prefix=" "/>
    </layout>
  </bibliography>
</style>`;

const ALPHA_NOTE = "alphanote";
const BETA_NOTE = "betanote";

function noteClassStyle(id: string, note: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="note" version="1.0">
  <info>
    <title>Note class ${note}</title>
    <id>${id}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text value="${note}"/></layout></citation>
  <bibliography><layout><text value="${note}entry"/></layout></bibliography>
</style>`;
}

const ALPHA_STYLE_ID = "http://www.zotero.org/styles/note-alpha";
const BETA_STYLE_ID = "http://www.zotero.org/styles/note-beta";

const STYLES = {
  "vault-prose.csl": VAULT_STYLE,
  "note-numbered.csl": NOTE_STYLE,
  "note-alpha.csl": noteClassStyle(ALPHA_STYLE_ID, ALPHA_NOTE),
  "note-beta.csl": noteClassStyle(BETA_STYLE_ID, BETA_NOTE),
};

function openVault(documentStyle: unknown) {
  return openCitationVault({
    styles: STYLES,
    settings: { "citation.references-style": VAULT_STYLE_ID },
    documentStyle,
  });
}

describe("document Citation Presentation", { timeout: TIMEOUT }, () => {
  it("inherits the vault style where the note names none", async () => {
    await using vault = await openVault(undefined);

    await expect(vault.citationText()).resolves.toBe(VAULT_WORD);
    await expect(vault.sidebarText()).resolves.toContain(VAULT_WORD);
    await expect(vault.popoverText()).resolves.toContain(VAULT_WORD);
    await expect(vault.copiedBibliography()).resolves.toContain(VAULT_WORD);

    const exported = await vault.exportNote();
    expect(exported.openedOn).toBe(VAULT_STYLE_ID);
    expect(exported.html).toContain(VAULT_WORD);
  });

  it("formats every surface in the style the note names", async () => {
    await using vault = await openVault(NOTE_STYLE_ID);

    await expect(vault.citationText()).resolves.toBe(MARKER);
    const sidebar = await vault.sidebarText();
    expect(sidebar).toContain(MARKER);
    expect(sidebar).toContain(NOTE_WORD);
    expect(sidebar).not.toContain(VAULT_WORD);
    const popover = await vault.popoverText();
    expect(popover).toContain(MARKER);
    expect(popover).toContain(NOTE_WORD);
    const copied = await vault.copiedBibliography();
    expect(copied).toContain(MARKER);
    expect(copied).toContain(NOTE_WORD);

    const exported = await vault.exportNote();
    expect(exported.openedOn).toBe(NOTE_STYLE_ID);
    expect(exported.html).toContain(MARKER);
    expect(exported.html).toContain(NOTE_WORD);
    expect(vault.vaultStyleMissing()).toBe(null);
  });

  it("formats every Imported Note surface in its stamped Profile style", async () => {
    await using vault = await openCitationVault({
      styles: STYLES,
      settings: {
        "citation.references-style": VAULT_STYLE_ID,
        profiles: [
          {
            id: PROFILE_ID,
            label: "Research",
            bindings: { "citation.references-style": NOTE_STYLE_ID },
          },
        ],
      },
      documentProperties: {
        "zotero-note-key": "1/NOTE1234",
        "zotlit-profile": PROFILE_ID,
      },
    });

    await expect(vault.citationText()).resolves.toBe(MARKER);
    await expect(vault.sidebarText()).resolves.toContain(NOTE_WORD);
    await expect(vault.popoverText()).resolves.toContain(NOTE_WORD);
    await expect(vault.copiedBibliography()).resolves.toContain(NOTE_WORD);

    const exported = await vault.exportNote();
    expect(exported.openedOn).toBe(NOTE_STYLE_ID);
    expect(exported.html).toContain(NOTE_WORD);

    await vault.setSettings({
      profiles: [
        {
          id: PROFILE_ID,
          label: "Research",
          bindings: { "citation.references-style": VAULT_STYLE_ID },
        },
      ],
    });
    await expect(vault.citationText()).resolves.toBe(VAULT_WORD);
    await expect(vault.sidebarText()).resolves.toContain(VAULT_WORD);
    await expect(vault.popoverText()).resolves.toContain(VAULT_WORD);
  });

  it("names an unavailable Imported Note Profile and its recovery", async () => {
    await using vault = await openCitationVault({
      styles: STYLES,
      settings: { "citation.references-style": VAULT_STYLE_ID },
      documentProperties: {
        "zotero-note-key": "1/NOTE1234",
        "zotlit-profile": "deleted-profile",
      },
    });

    await expect(vault.citationText()).resolves.toBeUndefined();
    const sidebar = await vault.minimalSidebarText();
    expect(sidebar).toContain(m.references_document_profile_failed_title());
    expect(sidebar).toContain("deleted-profile");
    expect(sidebar).toContain(m.profile_switch_recovery());
    await expect(vault.exportNote()).resolves.toMatchObject({ html: null });
  });

  it("names the Profile when its selected style is unavailable", async () => {
    await using vault = await openCitationVault({
      styles: STYLES,
      settings: {
        "citation.references-style": VAULT_STYLE_ID,
        profiles: [
          {
            id: PROFILE_ID,
            label: "Research",
            bindings: {
              "citation.references-style": UNINSTALLED_STYLE_ID,
            },
          },
        ],
      },
      documentProperties: {
        "zotero-note-key": "1/NOTE1234",
        "zotlit-profile": PROFILE_ID,
      },
    });

    const sidebar = await vault.minimalSidebarText();
    expect(sidebar).toContain(m.references_profile_style_failed_title());
    expect(sidebar).toContain(UNINSTALLED_STYLE_ID);
    expect(sidebar).toContain("choose another citation and references style");
    expect(sidebar).not.toContain("zotlit-csl");
    await expect(vault.exportNote()).resolves.toMatchObject({ html: null });
  });

  it("numbers one ordered citation set alike on every surface", async () => {
    await using vault = await openVault(NOTE_STYLE_ID);

    await expect(vault.citationText()).resolves.toBe(MARKER);
    await expect(vault.citationText(SECOND_CITATION_KEY)).resolves.toBe(
      SECOND_MARKER,
    );
    const sidebar = await vault.sidebarText();
    expect(sidebar).toContain(MARKER);
    expect(sidebar).toContain(SECOND_MARKER);
    await expect(vault.popoverText()).resolves.toContain(MARKER);
    await expect(vault.popoverText(SECOND_CITATION_KEY)).resolves.toContain(
      SECOND_MARKER,
    );
    const copied = await vault.copiedBibliography();
    expect(copied).toContain(MARKER);
    expect(copied).toContain(SECOND_MARKER);
  });

  it("returns no artifact when an export fails after a successful export", async ({
    annotate,
  }) => {
    await annotate(
      "https://github.com/aidenlx/zotlit-repo/issues/100",
      "issue",
    );
    await using vault = await openVault(NOTE_STYLE_ID);
    expect((await vault.exportNote()).html).toContain(NOTE_WORD);
    await vault.setNoteStyle(UNINSTALLED_STYLE_ID);
    await expect(vault.exportNote()).resolves.toMatchObject({ html: null });
  });

  it("keeps a per-run export style off the note", async () => {
    await using vault = await openVault(NOTE_STYLE_ID);

    const exported = await vault.exportNote({ styleId: VAULT_STYLE_ID });
    expect(exported.openedOn).toBe(NOTE_STYLE_ID);
    expect(exported.html).toContain(VAULT_WORD);
    expect(vault.noteStyle(EXPORT_NOTE)).toBe(NOTE_STYLE_ID);
    expect(vault.noteBody(EXPORT_NOTE)).toBe(EXPORT_BODY);
    await expect(vault.citationText()).resolves.toBe(MARKER);
  });

  it.each([
    ["names a style Zotero does not have", UNINSTALLED_STYLE_ID],
    ["carries no style ID at all", [NOTE_STYLE_ID]],
  ])("stops the note where it %s", async (_name, declared) => {
    await using vault = await openVault(declared);

    await expect(vault.citationText()).resolves.toBe(undefined);
    const sidebar = await vault.minimalSidebarText();
    expect(sidebar).toContain(m.references_document_style_failed_title());
    expect(sidebar).not.toContain(VAULT_WORD);
    expect(sidebar).not.toContain(NOTE_WORD);
    expect(vault.copyOffered()).toBe(false);
    await expect(vault.exportNote()).resolves.toMatchObject({ html: null });
    expect(vault.vaultStyleMissing()).toBe(null);
  });

  it("stops a note whose style is unavailable and whose works are not", async () => {
    await using vault = await openCitationVault({
      styles: STYLES,
      settings: { "citation.references-style": VAULT_STYLE_ID },
      documentStyle: UNINSTALLED_STYLE_ID,
      zoteroHoldsWork: false,
    });

    const sidebar = await vault.minimalSidebarText();
    expect(sidebar).toContain(m.references_document_style_failed_title());
    expect(vault.copyOffered()).toBe(false);
    expect(vault.vaultStyleMissing()).toBe(null);
  });

  it("moves every surface together when the note's style changes", async () => {
    await using vault = await openVault(undefined);
    await expect(vault.sidebarText()).resolves.toContain(VAULT_WORD);
    using popover = vault.showPopover();
    const shown = await popover.text();
    expect(shown).toContain(VAULT_WORD);

    await vault.setNoteStyle(NOTE_STYLE_ID);

    expect(vault.copyOffered()).toBe(false);
    await expect(vault.citationText()).resolves.toBe(MARKER);
    await expect(vault.sidebarText()).resolves.toContain(NOTE_WORD);
    await expect(popover.text(shown)).resolves.toContain(NOTE_WORD);
    await expect(vault.copiedBibliography()).resolves.toContain(NOTE_WORD);
  });

  it("re-reads the hovered citation's own note when the style changes", async () => {
    await using vault = await openVault(ALPHA_STYLE_ID);
    using popover = vault.showPopover();
    const shown = await popover.text();
    expect(shown.toLowerCase()).toContain(ALPHA_NOTE);

    await vault.setNoteStyle(BETA_STYLE_ID);

    const restyled = (await popover.text(shown)).toLowerCase();
    expect(restyled).toContain(BETA_NOTE);
    expect(restyled).not.toContain(ALPHA_NOTE);
  });
});
