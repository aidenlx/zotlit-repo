// The Advanced page's Reset citation index action: it asks first, then clears
// every stored citekey scan and rebuilds it from the vault, and names the
// outcome in a notice.
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

import { CitationIndex } from "./service.ts";

/**
 * Clear every stored citekey scan and rebuild it from the vault. The rebuild
 * runs on past this action, so the notice names it rather than claiming it is
 * done.
 */
export const resetCitationIndex = Effect.fn("SettingTab.resetCitationIndex")(
  function* (confirm: Effect.Effect<boolean>) {
    if (!(yield* confirm)) return "cancelled" as const;
    yield* CitationIndex.use((index) => index.reset);
    return "completed" as const;
  },
  withLogCategory("setting-tab", "advanced"),
);

/** Report a confirmed index reset, preserving silence on cancellation. */
export const reportResetCitationIndex = (confirm: Effect.Effect<boolean>) =>
  reportOutcome(resetCitationIndex(confirm), {
    success: (outcome) =>
      outcome === "completed" ? m.notice_citation_index_reset() : undefined,
    error: () => m.notice_citation_index_reset_failed(),
  });

/** The Recovery group's Reset citation index row. */
export function citationIndexResetItem(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_citation_index_reset",
    name: m.settings_citation_index_reset_name(),
    desc: m.settings_citation_index_reset_desc(),
    action: () =>
      void ctx.tab.run(
        reportResetCitationIndex(
          awaitConfirm(
            {
              title: m.settings_citation_index_reset_confirm_title(),
              content: m.settings_citation_index_reset_confirm_body(),
              action: m.settings_citation_index_reset_action(),
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
    CitationIndex: CitationIndex;
  }
}
