import { Effect } from "effect";

import { companionDocsUrl } from "@zotlit/obsidian-kit/docs-url.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

interface CompanionNoticeAction {
  label: string;
  run: () => void;
}

interface CompanionNoticeCopy {
  title: string;
  actions: readonly CompanionNoticeAction[];
}

export function companionNotice(options: {
  openReleaseNote: () => void;
}): CompanionNoticeCopy {
  return {
    title: m.companion_zotero_10_guidance(),
    actions: [
      { label: m.notice_update_see_whats_new(), run: options.openReleaseNote },
      {
        label: m.notice_companion_install_action(),
        run: () => {
          window.open(companionDocsUrl());
        },
      },
    ],
  };
}

export const showCompanionNotice = Effect.fn("Release.showCompanionNotice")(
  function* (copy: CompanionNoticeCopy) {
    const notifier = yield* Notifier;
    return yield* notifier.show(
      {
        title: copy.title,
        actions: copy.actions.map((action) => ({
          label: action.label,
          run: action.run,
        })),
      },
      { duration: 0 },
    );
  },
);
