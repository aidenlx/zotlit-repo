// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect, it as plainIt, vi } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { companionDocsUrl } from "@zotlit/obsidian-kit/docs-url.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { companionNotice, showCompanionNotice } from "./notices.ts";

describe("companionNotice", () => {
  plainIt(
    "offers the Release Note first, then the Companion installation guide",
    () => {
      const openReleaseNote = vi.fn();
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const notice = companionNotice({ openReleaseNote });

      expect(notice.title).toBe(m.companion_zotero_10_guidance());
      expect(notice.actions.map(({ label }) => label)).toEqual([
        m.notice_update_see_whats_new(),
        m.notice_companion_install_action(),
      ]);

      notice.actions[0]!.run();
      expect(openReleaseNote).toHaveBeenCalledOnce();
      notice.actions[1]!.run();
      expect(open).toHaveBeenCalledExactlyOnceWith(companionDocsUrl());
    },
  );
});

describe("showCompanionNotice", () => {
  it.effect("shows the notice until the user closes it", () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      yield* showCompanionNotice(
        companionNotice({ openReleaseNote: () => {} }),
      ).pipe(Effect.provideService(Notifier, notifier.service));

      expect(notifier.notices).toHaveLength(1);
      const [notice] = notifier.notices;
      expect(notice!.duration).toBe(0);
      const message = notice!.messages[0] as DocumentFragment;
      expect(message.textContent).toContain(m.companion_zotero_10_guidance());
    }),
  );
});
