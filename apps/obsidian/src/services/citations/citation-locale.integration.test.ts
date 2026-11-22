import { describe, expect, it } from "vitest";

import {
  openCitationVault,
  TIMEOUT,
} from "@/services/citations/__fixtures__/citation-surfaces.ts";

const STYLE_ID = "http://www.zotero.org/styles/localized";

const STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Localized</title>
    <id>${STYLE_ID}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text term="editor" form="long"/></layout></citation>
  <bibliography><layout><text term="editor" form="long"/></layout></bibliography>
</style>`;

const EDITOR = { en: "editor", "de-DE": "Herausgeber" };

function openVault(locale: string | null) {
  return openCitationVault({
    styles: { "localized.csl": STYLE },
    settings: {
      "citation.references-style": STYLE_ID,
      "citation.locale": locale,
    },
  });
}

describe("vault Citation Locale", { timeout: TIMEOUT }, () => {
  it("formats every in-app surface and the built-in export in it", async () => {
    await using vault = await openVault("de-DE");

    await expect(vault.citationText()).resolves.toBe(EDITOR["de-DE"]);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.popoverText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );

    const exported = await vault.exportNote();
    expect(exported.html).toContain(EDITOR["de-DE"]);
    expect(exported.html).not.toMatch(/<html[^>]*lang=/);
  });

  it("leaves Style default to the selected style", async () => {
    await using vault = await openVault(null);

    await expect(vault.citationText()).resolves.toBe(EDITOR.en);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR.en);
    await expect(vault.popoverText()).resolves.toContain(EDITOR.en);
    await expect(vault.copiedBibliography()).resolves.toContain(EDITOR.en);
    const exported = await vault.exportNote();
    expect(exported.html).toContain(EDITOR.en);
  });

  it("moves every surface together when the setting changes", async () => {
    await using vault = await openVault(null);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR.en);
    using popover = vault.showPopover();
    const shown = await popover.text();
    expect(shown).toContain(EDITOR.en);

    await vault.setSettings({ "citation.locale": "de-DE" });

    expect(vault.copyOffered()).toBe(false);
    await expect(vault.citationText()).resolves.toBe(EDITOR["de-DE"]);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(popover.text(shown)).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );
    const exported = await vault.exportNote();
    expect(exported.html).toContain(EDITOR["de-DE"]);
  });
});
