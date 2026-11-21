// Outcome notices of the Template Workbench links.
import { Effect } from "effect";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeMessage } from "@zotlit/obsidian-kit/notifier.ts";
import { linkOutcomeNotices } from "@zotlit/plugin-services/obsidian/protocol/notices.ts";
import { LinkOutcome } from "@zotlit/plugin-services/obsidian/protocol/outcome.ts";

/**
 * Show the notice of a Template Workbench link's outcome: a refusal shows its
 * message; an ignored link and an open show none.
 */
export const showWorkbenchLinkOutcome = Effect.fn(
  "protocol.showWorkbenchLinkOutcome",
)(function* (outcome: LinkOutcome) {
  const notifier = yield* Notifier;
  const show = (message: NoticeMessage) =>
    Effect.asVoid(notifier.show(message));
  yield* LinkOutcome.$match(outcome, {
    ...linkOutcomeNotices(show, Effect.void),
  });
});
