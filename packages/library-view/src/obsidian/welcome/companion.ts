import { Effect, Stream } from "effect";

import { held } from "@zotlit/obsidian-kit/view-atoms.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

const RETRY_SECONDS = [0, 1, 2, 4, 8];

export const companionInstalledAtom = held(
  Stream.unwrap(
    Effect.gen(function* () {
      const pref = yield* ZoteroPref;
      const reads = yield* ZoteroReads;
      const triggers = Stream.mergeAll(
        [
          Stream.make(undefined),
          Stream.drop(pref.changes, 1),
          Stream.filter(reads.events, (event) => event._tag === "changed"),
          Stream.fromEventListener(window, "focus"),
        ],
        { concurrency: "unbounded" },
      );
      return Stream.switchMap(triggers, () =>
        Stream.fromIterable(RETRY_SECONDS).pipe(
          Stream.mapEffect((seconds) =>
            Effect.andThen(
              Effect.sleep(`${seconds} seconds`),
              pref.companionInstalled,
            ),
          ),
          Stream.takeUntil((installed) => installed),
        ),
      );
    }),
  ),
  false,
);
