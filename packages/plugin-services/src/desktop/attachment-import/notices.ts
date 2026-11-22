import { Effect, Layer } from "effect";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeHandle } from "@zotlit/obsidian-kit/notifier.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { AttachmentImport } from "./service.ts";
import type { AttachmentSkipSummary } from "./service.ts";

const ATTACHMENT_SKIP_NOTICE_DURATION_MS = 30_000;

export interface AttachmentSkipNoticePorts {
  readonly openSettings: () => void;
}

export const layerAttachmentSkipNotice = (
  ports: AttachmentSkipNoticePorts,
): Layer.Layer<never, never, AttachmentImport | Notifier> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const { skipped } = yield* AttachmentImport;
      const notifier = yield* Notifier;
      const run = Effect.runSyncWith(yield* Effect.context<never>());
      yield* forkEach(skipped, (summary) =>
        Effect.gen(function* () {
          let notice: NoticeHandle | null = null;
          notice = yield* notifier.show(
            skipNoticeMessage(summary, () => {
              if (notice) run(notice.hide);
              ports.openSettings();
            }),
            { duration: ATTACHMENT_SKIP_NOTICE_DURATION_MS },
          );
        }),
      );
    }),
  );

function skipNoticeMessage(
  { blocked, refused, blockedFolders }: AttachmentSkipSummary,
  openSettings: () => void,
): DocumentFragment {
  return BaseNotice.render((renderer) => {
    renderer.setTitle(
      m.notice_attachment_sources_skipped({ count: blocked + refused }),
    );
    if (blockedFolders.length > 0) {
      renderer.addList(
        m.notice_attachment_sources_skipped_folders({
          count: blockedFolders.length,
        }),
        blockedFolders,
      );
      renderer.addText(
        m.notice_attachment_sources_skipped_next({
          count: blockedFolders.length,
        }),
      );
    }
    renderer.addAction((button) => {
      button
        .setButtonText(m.notice_attachment_sources_skipped_action())
        .onClick(openSettings);
    });
  });
}
