// The Advanced page's Clear excerpt image cache action: it asks first, then
// empties the Excerpt Image store the plugin can always fill again, and names
// the outcome in a notice.
import { Effect } from "effect";
import type { SettingGroupItem } from "obsidian";

import { awaitConfirm } from "@zotlit/obsidian-kit/confirm.ts";
import { reportOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log-category.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import { ExcerptDisplays } from "./display.ts";

import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";

/** Empty the Excerpt Image store and release every display that paints from it. */
export const clearExcerptCache = Effect.fn("SettingTab.clearExcerptCache")(
  function* (confirm: Effect.Effect<boolean>) {
    if (!(yield* confirm)) return "cancelled" as const;
    const displays = yield* ExcerptDisplays;
    const images = yield* ExcerptImageService;
    // The Held Reads go first: a card that repainted from the store while
    // it emptied would hold an image the clear removed.
    yield* displays.clear;
    yield* images.clear;
    return "completed" as const;
  },
  withLogCategory("setting-tab", "advanced"),
);

/** Report a confirmed cache clear, preserving silence on cancellation. */
export const reportClearExcerptCache = (confirm: Effect.Effect<boolean>) =>
  reportOutcome(clearExcerptCache(confirm), {
    success: (outcome) =>
      outcome === "completed" ? m.notice_excerpt_cache_cleared() : undefined,
    error: () => m.notice_excerpt_cache_clear_failed(),
  });

/** The Recovery group's Clear excerpt image cache row. */
export function excerptCacheClearItem(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_excerpt_cache_clear",
    name: m.settings_excerpt_cache_clear_name(),
    desc: m.settings_excerpt_cache_clear_desc(),
    action: () =>
      void ctx.tab.run(
        reportClearExcerptCache(
          awaitConfirm(
            {
              title: m.settings_excerpt_cache_clear_name(),
              content: m.settings_excerpt_cache_clear_confirm_body(),
              action: m.settings_excerpt_cache_clear_action(),
              destructive: true,
            },
            ctx.app,
          ),
        ),
      ),
  };
}

declare module "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    ExcerptDisplays: ExcerptDisplays;
    ExcerptImageService: ExcerptImageService;
  }
}
