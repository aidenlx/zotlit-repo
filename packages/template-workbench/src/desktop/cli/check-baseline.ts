import { Effect, Result } from "effect";

import { readLiveText } from "@zotlit/obsidian-kit/effect-live-text.ts";
import { parseProfileStamp } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { FIELD_LITERATURE_NOTE_PROFILE } from "@zotlit/plugin-kernel/constants.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";

import { sourceRevision } from "./inspect.ts";

import { previewBaseline } from "#obsidian/cli/preview-baseline.ts";

export const selectCheckBaseline = Effect.fnUntraced(function* (input: {
  key: string;
  note?: string;
  existing?: string;
}) {
  let source: string | null = input.existing ?? null;
  let path: string | null = null;
  let kind: "supplied" | "real" | "synthetic" =
    input.existing === undefined ? "synthetic" : "supplied";
  const failed = (error: unknown) => ({
    ok: false as const,
    baseline: {
      kind,
      path,
      indexedKey: input.key,
      revision: source === null ? null : sourceRevision(source),
    },
    diagnostic: {
      code: "BASELINE_READ_FAILED",
      message: error instanceof Error ? error.message : String(error),
      hint:
        kind === "supplied"
          ? "Correct the supplied existing=<text> frontmatter and run the check again."
          : `Restore access to '${path}' and correct its frontmatter, then run the check again with note=${path}.`,
    },
  });
  if (input.existing === undefined) {
    const noteIndex = yield* NoteIndex;
    yield* noteIndex.whenIndexed;
    const candidates = yield* noteIndex.getNotesByItemKey(input.key);
    if (input.note === undefined && candidates.length > 1)
      return {
        ok: false as const,
        diagnostic: {
          code: "duplicate-literature-notes",
          message: "Multiple Literature Notes match this item.",
          hint: "Select one of the reported candidates with note=<path>, then run the check again.",
          candidates: candidates.map((file) => file.path),
        },
      };
    const selected =
      input.note === undefined
        ? candidates[0]
        : candidates.find((file) => file.path === input.note);
    if (input.note !== undefined && !selected)
      return {
        ok: false as const,
        diagnostic: {
          code: "TARGET_NOT_FOUND",
          message: "The selected path is not a Literature Note for this item.",
          hint: "Select one of the reported candidates with note=<path>, or omit note to use the only match.",
          candidates: candidates.map((file) => file.path),
        },
      };
    if (selected) {
      path = selected.path;
      kind = "real";
      const read = yield* Effect.result(readLiveText(selected));
      if (Result.isFailure(read)) return failed(read.failure.cause);
      source = read.success;
    }
  }
  const stamp = yield* Effect.result(
    Effect.try(() =>
      parseProfileStamp(
        previewBaseline(source, "", null).frontmatter[
          FIELD_LITERATURE_NOTE_PROFILE
        ],
      ),
    ),
  );
  if (Result.isFailure(stamp)) return failed(stamp.failure.cause);
  return { ok: true as const, source, kind, path, stamp: stamp.success };
});
