import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import { Effect } from "effect";
import type { PaneType, TFile } from "obsidian";

import { ATTACHMENT_ANCHOR_KEY } from "@zotlit/db";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

import type { ReaderOutcome, TargetReader } from "./open-target.ts";

export function obsidianAttachmentReader<E>({
  open,
  onOpened = Effect.void,
}: {
  readonly open: (
    file: TFile,
    subpath: string,
    pane: PaneType | boolean,
  ) => Effect.Effect<ReaderOutcome, E>;
  readonly onOpened?: Effect.Effect<void>;
}): Effect.Effect<TargetReader<E>, never, Vault> {
  return Effect.gen(function* () {
    const vault = yield* Vault;
    return {
      open: (
        attachment: ObsidianOpenableAttachment,
        pane: PaneType | boolean,
      ) =>
        Effect.gen(function* () {
          const file = yield* vault.getFileByPath(attachment.openPath);
          if (!file) {
            yield* Effect.logDebug(
              "Obsidian did not resolve the Attachment's open path",
            ).pipe(Effect.annotateLogs({ openPath: attachment.openPath }));
            return "file-missing" as const;
          }
          const outcome = yield* open(file, namingAttachment(attachment), pane);
          if (outcome === "opened") yield* onOpened;
          return outcome;
        }).pipe(withLogCategory("attachment-open")),
    } satisfies TargetReader<E>;
  });
}

function namingAttachment({
  subpath,
  indexedKey,
}: ObsidianOpenableAttachment): string {
  const named = `${ATTACHMENT_ANCHOR_KEY}=${encodeURIComponent(indexedKey)}`;
  return subpath ? `${subpath}&${named}` : `#${named}`;
}
