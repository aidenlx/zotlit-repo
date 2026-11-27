// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Exit, Layer, PubSub, Queue, Scope, Stream } from "effect";
import { expect, vi } from "vitest";

import {
  layerSignalling,
  noticeContentOf,
  testNotifier,
} from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import type { RecordedNotice } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { noticeText } from "@zotlit/obsidian-kit/notice.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { layerAttachmentSkipNotice } from "./notices.ts";
import type { AttachmentSkipSummary } from "./service.ts";
import { AttachmentImport } from "./service.ts";

const SUMMARY: AttachmentSkipSummary = {
  blocked: 2,
  refused: 1,
  blockedFolders: ["/outside"],
};

const register = Effect.fn("test.register")(function* (scope: Scope.Scope) {
  const skipped = yield* PubSub.unbounded<AttachmentSkipSummary>();
  const shown = yield* Queue.unbounded<void>();
  const notifier = testNotifier();
  const openSettings = vi.fn();
  yield* Layer.buildWithScope(
    layerAttachmentSkipNotice({ openSettings }).pipe(
      Layer.provide(
        Layer.mock(AttachmentImport, { skipped: Stream.fromPubSub(skipped) }),
      ),
      Layer.provide(layerSignalling(notifier.service, shown)),
    ),
    scope,
  );
  return { skipped, shown, notices: notifier.notices, openSettings };
});

function partsOf(notice: RecordedNotice | undefined) {
  const content = noticeContentOf(notice?.messages[0]);
  return { text: noticeText(content), action: content.actions![0]! };
}

it.effect("shows one notice for each skip summary, naming the folders", () =>
  Effect.gen(function* () {
    const { skipped, shown, notices } = yield* register(yield* Effect.scope);

    yield* PubSub.publish(skipped, SUMMARY);
    yield* Queue.take(shown);

    expect(notices).toHaveLength(1);
    expect(notices[0]?.duration).toBe(30_000);
    const { text } = partsOf(notices[0]);
    expect(text).toContain(m.notice_attachment_sources_skipped({ count: 3 }));
    expect(text).toContain("/outside");
  }),
);

it.effect("opens the settings and hides the notice from its action", () =>
  Effect.gen(function* () {
    const { skipped, shown, notices, openSettings } = yield* register(
      yield* Effect.scope,
    );
    yield* PubSub.publish(skipped, SUMMARY);
    yield* Queue.take(shown);

    partsOf(notices[0]).action.run();

    expect(openSettings).toHaveBeenCalledOnce();
    expect(notices[0]?.hidden).toBe(true);
  }),
);

it.effect("shows nothing for a summary published after the Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const { skipped, notices } = yield* register(scope);

    yield* Scope.close(scope, Exit.void);
    yield* PubSub.publish(skipped, SUMMARY);

    expect(notices).toEqual([]);
  }),
);
