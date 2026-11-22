import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
import { Effect } from "effect";
import type { SettingGroupItem } from "obsidian";

import { awaitConfirm } from "@zotlit/obsidian-kit/confirm.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log-category.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { LanguagePack } from "./service.ts";

export const resetLanguagePacks = Effect.fn("SettingTab.resetLanguagePacks")(
  function* (confirm: Effect.Effect<boolean>) {
    if (!(yield* confirm)) return;
    yield* LanguagePack.use((pack) => pack.reset);
    yield* Notifier.use((notifier) =>
      notifier.show(m.notice_language_pack_reset()),
    );
  },
  withLogCategory("setting-tab", "advanced"),
);

export function languagePackResetItem(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_language_pack_reset",
    name: m.settings_language_pack_reset_name(),
    desc: m.settings_language_pack_reset_desc(),
    action: () =>
      void ctx.tab.run(
        resetLanguagePacks(
          awaitConfirm(
            {
              title: m.settings_language_pack_reset_confirm_title(),
              content: m.settings_language_pack_reset_confirm_body({
                plugin: ctx.manifest.name,
              }),
              action: m.settings_language_pack_reset_action(),
              destructive: true,
            },
            ctx.app,
          ),
        ),
        m.settings_failed_language_pack_reset(),
      ),
  };
}

declare module "#obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    LanguagePack: LanguagePack;
  }
}
