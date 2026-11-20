import { afterEach, expect, test } from "vitest";

import * as shared from "@zotlit/plugin-messages/messages.ts";
import { catalog } from "@zotlit/reader-messages/catalog.ts";
import basePack from "@zotlit/reader-messages/en.json";
import * as m from "@zotlit/reader-messages/messages.ts";
import { runtime } from "@zotlit/reader-messages/runtime.ts";

afterEach(() => runtime.reset());

test("shared code in the Reader reads the Reader's own facade", () => {
  expect(shared).toBe(m);
});

test("the facade gives the English text of a pdf_reader_ Message and of the start-up notice", () => {
  expect(m.pdf_reader_view_name()).toBe("ZotLit PDF reader");
  expect(m.notice_startup_failed({ plugin: "ZotLit Reader" })).toBe(
    "ZotLit Reader could not start",
  );
});

test("the base pack holds the Reader's subset only and the catalog lists zh-CN", () => {
  expect(basePack.messages).toHaveProperty("pdf_reader_view_name");
  expect(basePack.messages).not.toHaveProperty("annot_view_clear_search");
  expect(catalog).toEqual({
    baseLocale: "en",
    packs: { "zh-CN": { fileName: "zh-CN.json" } },
  });
});
