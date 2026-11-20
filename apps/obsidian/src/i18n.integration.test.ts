import { afterEach, expect, test } from "vitest";

import { LANGUAGE_PACK_LIMITS } from "@zotlit/obsidian-i18n";
import { catalog } from "@zotlit/plugin-messages/catalog.ts";
import basePack from "@zotlit/plugin-messages/en.json";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import zhPack from "@zotlit/plugin-messages/zh-CN.json";

// Turbo generates these artifacts before testing; compiler mechanics are
// covered in @zotlit/obsidian-i18n. Check the plugin's actual build output here.
afterEach(() => runtime.reset());

test("the plugin pack contains its shared labels and fits the runtime cap", () => {
  expect(basePack.messages).not.toHaveProperty("docs_index_title");
  // Native shared controls read the same pack as the rest of the plugin.
  expect(basePack.messages).toMatchObject({
    workbench_title: "Template workbench",
    workbench_tab_match: "Match",
  });
  expect(basePack.messages).not.toHaveProperty(["zotero.menu_file.label"]);
  expect(basePack.messages).toHaveProperty(["zotero.prefs_notify_section"]);
  // A pack over the cap is refused at runtime, and copy another host owns is
  // what fills it. Add the new prefix to EXCLUDE_MESSAGE_PREFIXES when this
  // fails for messages the plugin never reads.
  expect(Object.keys(basePack.messages).length).toBeLessThanOrEqual(
    LANGUAGE_PACK_LIMITS.messages,
  );
  expect(catalog).toEqual({
    baseLocale: "en",
    packs: { "zh-CN": { fileName: "zh-CN.json" } },
  });
});

test("the generated facade renders bundled lifecycle copy and base-locale fallback", () => {
  expect(m.hello()).toBe("world");
  // Lifecycle copy renders in the target language from the bundled subset,
  // with no Language Pack installed and no network access.
  expect(m.settings_language_pack_name()).toBe("Language pack");
  runtime.setTargetLocale("zh-CN");
  expect(m.settings_language_pack_name()).toBe("语言包");
  expect(
    m.settings_language_pack_desc({ plugin: "ZotLit", language: "简体中文" }),
  ).toBe("以 简体中文 显示 ZotLit 界面。安装时将下载语言包。");
  // Everything outside the configured prefixes keeps the existing ladder.
  expect(m.hello()).toBe("world");
  expect(m.workbench_tab_match()).toBe("Match");
  expect(m.creator_summary({ count: 3, first: "Ada" })).toBe("Ada et al.");
});

const languagePackTexts = (plugin: string) => [
  m.notice_language_pack_install({ plugin, language: "简体中文" }),
  m.notice_language_pack_downloading({ plugin }),
  m.notice_language_pack_download_failed({ plugin, message: "Offline." }),
  m.notice_language_pack_restart({ plugin }),
  m.notice_language_pack_update_needed({ plugin }),
  m.settings_language_pack_desc({ plugin, language: "简体中文" }),
  m.settings_language_pack_reset_confirm_body({ plugin }),
];

test.each([
  [
    "en",
    [
      "ZotLit language pack for 简体中文 is available.",
      "Downloading ZotLit language pack…",
      "Couldn't download the ZotLit language pack. Offline.",
      "Restart Obsidian to apply the ZotLit language pack.",
      "Update ZotLit to install the ZotLit language pack.",
      "Show ZotLit's interface in 简体中文. Installing downloads a language pack.",
      "Downloaded language packs are removed. ZotLit offers to install them again after a restart.",
    ],
  ],
  [
    "zh-CN",
    [
      "ZotLit 简体中文 语言包可用。",
      "正在下载 ZotLit 语言包…",
      "无法下载 ZotLit 语言包。Offline.",
      "重启 Obsidian 以应用 ZotLit 语言包。",
      "请更新 ZotLit 以安装语言包。",
      "以 简体中文 显示 ZotLit 界面。安装时将下载语言包。",
      "已下载的语言包将被移除。重启后 ZotLit 会再次询问是否安装。",
    ],
  ],
])(
  "ZotLit's Language Pack texts in %s read as they did before they took the plugin name",
  (locale, expected) => {
    if (locale !== "en") {
      runtime.install(zhPack as Parameters<typeof runtime.install>[0]);
      runtime.setTargetLocale(locale);
    }
    expect(languagePackTexts("ZotLit")).toEqual(expected);
  },
);
