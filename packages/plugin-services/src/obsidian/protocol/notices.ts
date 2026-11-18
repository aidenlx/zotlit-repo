// The notices of the outcomes every link handler shares.
import { Effect } from "effect";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeMessage } from "@zotlit/obsidian-kit/notifier.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { LinkOutcome } from "./outcome.ts";
import type { LinkOutcomeVariants } from "./outcome.ts";

/**
 * The notice of each shared outcome, for a handler's own `$match`: a refusal
 * shows its message through `show`; a link from another Zotero and an open
 * show none.
 */
export function linkOutcomeNotices<R>(
  show: (message: NoticeMessage) => Effect.Effect<void, never, R>,
  none: Effect.Effect<void, never, R>,
): {
  readonly [K in keyof LinkOutcomeVariants]: () => Effect.Effect<
    void,
    never,
    R
  >;
} {
  return {
    InvalidLink: () => show(m.notice_protocol_invalid()),
    ForeignSource: () => none,
    DatabaseUnavailable: () => show(m.notice_protocol_db_unavailable()),
    ItemNotFound: () => show(m.notice_protocol_item_not_found()),
    Opened: () => none,
  };
}

/** Show the notice of a shared outcome, for a handler that has no outcome of its own. */
export const showLinkOutcome = Effect.fn("protocol.showLinkOutcome")(function* (
  outcome: LinkOutcome,
) {
  const notifier = yield* Notifier;
  yield* LinkOutcome.$match(
    outcome,
    linkOutcomeNotices(
      (message) => Effect.asVoid(notifier.show(message)),
      Effect.void,
    ),
  );
});
