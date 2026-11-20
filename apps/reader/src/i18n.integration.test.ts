import { afterEach, expect, test } from "vitest";

import * as shared from "@zotlit/plugin-messages/messages.ts";
import { catalog } from "@zotlit/reader-messages/catalog.ts";
import basePack from "@zotlit/reader-messages/en.json";
import * as m from "@zotlit/reader-messages/messages.ts";
import { runtime } from "@zotlit/reader-messages/runtime.ts";
import zhPack from "@zotlit/reader-messages/zh-CN.json";

afterEach(() => runtime.reset());

test("shared code in the Reader reads the Reader's own facade", () => {
  expect(shared).toBe(m);
});

test("the facade gives the English text of a pdf_reader_ Message and of the start-up notice", () => {
  expect(m.pdf_reader_zoom_in()).toBe("Zoom in");
  expect(m.notice_startup_failed({ plugin: "ZotLit Reader" })).toBe(
    "ZotLit Reader could not start",
  );
});

test("the base pack holds the Reader's subset only and the catalog lists zh-CN", () => {
  expect(basePack.messages).toHaveProperty("pdf_reader_zoom_in");
  expect(basePack.messages).not.toHaveProperty("annot_view_clear_search");
  expect(catalog).toEqual({
    baseLocale: "en",
    packs: { "zh-CN": { fileName: "zh-CN.json" } },
  });
});

const renderedByTheReader = (plugin: string) => [
  m.notice_language_pack_install({ plugin, language: "简体中文" }),
  m.notice_language_pack_downloading({ plugin }),
  m.notice_language_pack_download_failed({ plugin, message: "Offline." }),
  m.notice_language_pack_restart({ plugin }),
  m.notice_language_pack_update_needed({ plugin }),
  m.settings_language_pack_desc({ plugin, language: "简体中文" }),
  m.settings_language_pack_reset_confirm_body({ plugin }),
  m.reader_view_name(),
  m.reader_takeover_unavailable(),
];

test.each([
  [
    "en",
    "ZotLit Reader language pack for 简体中文 is available.",
    "ZotLit Reader can’t open all PDFs in this version of Obsidian. PDFs keep opening in Obsidian’s PDF viewer.",
  ],
  [
    "zh-CN",
    "ZotLit Reader 简体中文 语言包可用。",
    "此版本的 Obsidian 不支持在 ZotLit Reader 中打开所有 PDF。PDF 仍在 Obsidian 的 PDF 查看器中打开。",
  ],
])(
  "the Reader names itself, not ZotLit, in the texts it shows in %s",
  (locale, offer, takeover) => {
    if (locale !== "en") {
      runtime.install(zhPack as Parameters<typeof runtime.install>[0]);
      runtime.setTargetLocale(locale);
    }
    const texts = renderedByTheReader("ZotLit Reader");
    expect(texts[0]).toBe(offer);
    expect(texts.at(-1)).toBe(takeover);
    expect(texts.every((text) => text.includes("ZotLit Reader"))).toBe(true);
    expect(
      texts.filter((text) =>
        text.replaceAll("ZotLit Reader", "").includes("ZotLit"),
      ),
    ).toEqual([]);
  },
);
