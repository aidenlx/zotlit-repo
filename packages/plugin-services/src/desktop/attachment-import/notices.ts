import { Effect, Layer } from "effect";

import { noticeList } from "@zotlit/obsidian-kit/notice.ts";
import type { NoticeContent } from "@zotlit/obsidian-kit/notice.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
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
      yield* forkEach(skipped, (summary) =>
        notifier.show(skipNoticeMessage(summary, ports.openSettings), {
          duration: ATTACHMENT_SKIP_NOTICE_DURATION_MS,
        }),
      );
    }),
  );

function skipNoticeMessage(
  { blocked, refused, blockedFolders }: AttachmentSkipSummary,
  openSettings: () => void,
): NoticeContent {
  return {
    title: m.notice_attachment_sources_skipped({ count: blocked + refused }),
    ...(blockedFolders.length > 0
      ? {
          lines: [
            ...noticeList(
              m.notice_attachment_sources_skipped_folders({
                count: blockedFolders.length,
              }),
              blockedFolders,
            ),
            m.notice_attachment_sources_skipped_next({
              count: blockedFolders.length,
            }),
          ],
        }
      : {}),
    actions: [
      {
        label: m.notice_attachment_sources_skipped_action(),
        run: openSettings,
      },
    ],
  };
}
