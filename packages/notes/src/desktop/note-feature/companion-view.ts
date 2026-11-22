import { Effect } from "effect";
import type { App, PaneType } from "obsidian";

import type { ItemRef } from "@zotlit/db";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ProtocolAction } from "@zotlit/protocol";

import type { InteractiveCreationPorts } from "./creation-view.ts";
import type { CompanionNoteTarget, UpdateScope } from "./operations.ts";
import { noteOperationDiagnosticContent } from "./update-single.ts";

export type { LiteratureNoteOutcome as CompanionLinkOutcome } from "./navigation.ts";
import type { LiteratureNoteOutcome as CompanionLinkOutcome } from "./navigation.ts";
import { openLiteratureNote } from "./navigation.ts";

export const openCompanionNote = Effect.fn("openCompanionNote")(function* (
  deps: InteractiveCreationPorts,
  ref: ItemRef,
  options: CompanionLinkOptions,
) {
  const outcome = yield* followCompanionLink(deps, ref, options);
  const notice = companionLinkNotice(deps.app, outcome);
  if (notice) yield* (yield* Notifier).show(notice);
});

export interface CompanionLinkOptions {
  action: ProtocolAction;
  profile?: ProfileSelector;
  scope?: UpdateScope;
  paneType?: PaneType;
}

export const followCompanionLink = Effect.fn("CompanionLink.follow")(
  (
    deps: InteractiveCreationPorts,
    ref: ItemRef,
    options: CompanionLinkOptions,
  ) =>
    openLiteratureNote(deps, ref.indexedKey, {
      source: "companion",
      ...options,
    }),
);

export function companionLinkNotice(
  app: App,
  outcome: CompanionLinkOutcome,
): string | DocumentFragment | undefined {
  switch (outcome.outcome) {
    case "refused":
    case "opened-as-is":
      return companionNoteNotice(app, outcome.target);
    case "metadata-no-note":
      return m.notice_update_metadata_no_note();
    default:
      return undefined;
  }
}

export function companionNoteNotice(
  app: App,
  target: CompanionNoteTarget,
): string | DocumentFragment | undefined {
  if (target.outcome !== "create" && target.diagnostic)
    return noteOperationDiagnosticContent(app, target.diagnostic);
  if (target.outcome === "existing" && target.keptProfile)
    return m.notice_literature_note_profile_kept({
      label: target.keptProfile.label ?? m.settings_profile_default_name(),
    });
  return undefined;
}
