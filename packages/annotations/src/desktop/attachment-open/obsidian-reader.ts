import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import { Effect } from "effect";
import type { PaneType, TFile } from "obsidian";

import { ATTACHMENT_ANCHOR_KEY } from "@zotlit/db";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

import type { ReaderOutcome, TargetReader } from "./open-target.ts";

/**
 * The ZotLit PDF Reader, opened through `open`. `Vault.getFileByPath`
 * already answers `null` for a path with no real file behind it — an in-vault
 * path absent from `fileMap`, or (via Obsidian's external-file fall-through) a
 * `file:`-prefixed path `lstat` finds nothing at — so that `null` is the one
 * signal a Zotero library moving or deleting an Attachment between the read
 * that offered it and the click needs to be caught by. The reader reports it
 * and shows nothing: the caller decides what a missing file means.
 *
 * @param onOpened runs once the file is on screen, and only then — a missing
 * file leaves it unrun, so a caller can hang follow-up UI off a real open.
 */
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

/**
 * The subpath an open carries: where to land, and the Attachment it opens.
 * Two Attachments can keep one file, and the PDF view's binding names its
 * Attachment from this rather than from the path when the open names one.
 * Appended rather than re-serialised, so the keys Obsidian reads by name keep
 * the spelling they were written in.
 *
 * @see apps/obsidian/docs/adr/0046-landing-on-a-mark-is-an-ephemeral-state-contract-read-at-the-leaf.md
 */
function namingAttachment({
  subpath,
  indexedKey,
}: ObsidianOpenableAttachment): string {
  const named = `${ATTACHMENT_ANCHOR_KEY}=${encodeURIComponent(indexedKey)}`;
  return subpath ? `${subpath}&${named}` : `#${named}`;
}
