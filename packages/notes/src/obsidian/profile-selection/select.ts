import type { MatchItem } from "#core/profile-selection/item-matches.ts";
import type { LiteratureNoteProfile } from "#obsidian/profile/service.ts";
import { Effect } from "effect";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { ItemMatchQuery } from "#core/profile-selection/item-matches.ts";

const logged = withLogCategory("services", "profile-selection");

export type MatchSelection =
  | {
      outcome: "matched";
      profile: LiteratureNoteProfile;
      reason: { profile: string };
    }
  | { outcome: "overlap"; candidates: readonly LiteratureNoteProfile[] }
  | { outcome: "unmatched" }
  | { outcome: "failed" };

export const selectProfilesByMatch = Effect.fnUntraced(function* (
  profiles: readonly LiteratureNoteProfile[],
  items: readonly MatchItem[],
) {
  const tested = profiles.flatMap((profile) =>
    profile.match.state === "evaluable"
      ? [{ profile, filter: profile.match.filter }]
      : [],
  );
  const filters = tested.map(({ filter }) => filter);
  const answer =
    tested.length > 0 && items.length > 0
      ? yield* (yield* ItemMatchQuery).matches(items, filters)
      : undefined;
  if (answer?.kind === "failed") {
    yield* Effect.logWarning(
      "Profile Matches could not be read for {count} Items",
    ).pipe(Effect.annotateLogs({ count: items.length, answer }), logged);
    return items.map((): MatchSelection => ({ outcome: "failed" }));
  }
  const missing = answer
    ? items.filter(
        ({ key, groupID }) => !answer.byKey.has(formatIndexedKey(key, groupID)),
      )
    : [];
  if (missing.length > 0)
    yield* Effect.logWarning(
      "ZotLit Query did not find {count} Items to match",
    ).pipe(
      Effect.annotateLogs({
        count: missing.length,
        keys: missing.slice(0, 10).map(({ key }) => key),
      }),
      logged,
    );
  const faults = answer?.byKey.values().next().value?.faults ?? [];
  if (faults.some(Boolean))
    yield* Effect.logDebug("Some Profile Matches could not be evaluated").pipe(
      Effect.annotateLogs({ faults }),
      logged,
    );
  return items.map((item): MatchSelection => {
    let held = new Set<LiteratureNoteProfile>();
    if (answer) {
      const row = answer.byKey.get(formatIndexedKey(item.key, item.groupID));
      if (!row) return { outcome: "failed" };
      held = new Set(
        tested.flatMap(({ profile }, index) =>
          row.matched[index] ? [profile] : [],
        ),
      );
    }
    const candidates = profiles.filter(
      (profile) => profile.match.state === "all" || held.has(profile),
    );
    if (candidates.length === 0) return { outcome: "unmatched" };
    if (candidates.length > 1) return { outcome: "overlap", candidates };
    const profile = candidates[0]!;
    return { outcome: "matched", profile, reason: { profile: profile.label } };
  });
});

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    ItemMatchQuery: ItemMatchQuery;
  }
}
