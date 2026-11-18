// Outcome notices of the Template Workbench links.
import { Effect } from "effect";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeMessage } from "@zotlit/obsidian-kit/notifier.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { linkOutcomeNotices } from "@zotlit/plugin-services/obsidian/protocol/notices.ts";

import { WorkbenchLinkOutcome } from "./outcome.ts";

/**
 * Show the notice of a Template Workbench link's outcome: a refusal or a
 * failed Profile import shows its message; an ignored link, an open, and a
 * cancel show none.
 */
export const showWorkbenchLinkOutcome = Effect.fn(
  "protocol.showWorkbenchLinkOutcome",
)(function* (outcome: WorkbenchLinkOutcome) {
  const notifier = yield* Notifier;
  const show = (message: NoticeMessage) =>
    Effect.asVoid(notifier.show(message));
  yield* WorkbenchLinkOutcome.$match(outcome, {
    ...linkOutcomeNotices(show, Effect.void),
    ProfileOpened: () => Effect.void,
    ProfileImportCancelled: () => Effect.void,
    ProfileImportFailed: () => show(m.notice_profile_action_failed()),
  });
});
