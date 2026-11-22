import { Effect } from "effect";
import type { ObsidianProtocolData } from "obsidian";

import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { showLinkOutcome } from "@zotlit/plugin-services/obsidian/protocol/notices.ts";
import { LinkOutcome } from "@zotlit/plugin-services/obsidian/protocol/outcome.ts";
import { protocolHandler } from "@zotlit/plugin-shell/obsidian/feature.ts";
import {
  parseShowInLibraryProtocolQuery,
  showInLibraryProtocolActionId,
} from "@zotlit/protocol";

const handleShowInLibraryProtocol = Effect.fn(
  "protocol.handleShowInLibraryProtocol",
)(function* (data: ObsidianProtocolData) {
  const query = yield* Effect.try(() =>
    parseShowInLibraryProtocolQuery(data),
  ).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Invalid protocol query").pipe(
        Effect.annotateLogs({ action: "show-in-library", error: error.cause }),
        withLogCategory("protocol"),
        Effect.as(null),
      ),
    ),
  );
  if (!query) return LinkOutcome.InvalidLink();
  yield* (yield* ShowInLibrary).show(query.indexedKey);
  return LinkOutcome.Opened();
});

export const showInLibraryLink = protocolHandler(
  showInLibraryProtocolActionId,
  (data) => handleShowInLibraryProtocol(data).pipe(Effect.tap(showLinkOutcome)),
);
