// The Template Workbench link: `obsidian://zotlit/explore`, which opens the
// Template Data Explorer on an Item.
import { Effect, Result } from "effect";
import type { ObsidianProtocolData } from "obsidian";

import {
  parseProtocolData,
  resolveProtocolItem,
} from "@zotlit/plugin-services/obsidian/protocol/link.ts";
import { protocolHandler } from "@zotlit/plugin-shell/obsidian/feature.ts";
import {
  exploreProtocolActionId,
  parseExploreProtocolQuery,
} from "@zotlit/protocol";

import { showWorkbenchLinkOutcome } from "./notices.ts";
import { WorkbenchLinkOutcome } from "./outcome.ts";

import { openTemplateDataExplorer } from "#desktop/data-explorer/register.ts";

/** The Template Workbench links. */
export function workbenchLinks() {
  return [
    protocolHandler(exploreProtocolActionId, (data) =>
      handleExploreProtocol(data).pipe(Effect.tap(showWorkbenchLinkOutcome)),
    ),
  ];
}

const handleExploreProtocol = Effect.fn("protocol.handleExploreProtocol")(
  function* (data: ObsidianProtocolData) {
    const action = "explore";
    const query = yield* parseProtocolData(data, {
      action,
      parse: parseExploreProtocolQuery,
    });
    if (Result.isFailure(query)) return query.failure;

    const ref = yield* resolveProtocolItem(query.success, action);
    if (Result.isFailure(ref)) return ref.failure;

    yield* openTemplateDataExplorer(
      {
        itemIndexedKey: ref.success.indexedKey,
        anchorAnnotationKey: query.success.annotation,
      },
      { paneType: query.success.paneType },
    );
    return WorkbenchLinkOutcome.Opened();
  },
);
