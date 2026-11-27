import { Effect } from "effect";

import type { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

import { unavailable } from "./reads-facade.ts";

export const CONSENTED_ACCOUNT_KEY = "zotlit-online-library-account";
export const PENDING_REMOVAL_KEY = "zotlit-online-library-removal";

export interface RemovalSteps {
  readonly forgetKey: Effect.Effect<void, DbUnavailable>;
  readonly deleteReplica: Effect.Effect<void, DbUnavailable>;
}

export interface Consent {
  readonly current: Effect.Effect<number | null, DbUnavailable>;
  readonly removalPending: Effect.Effect<boolean, DbUnavailable>;
  grantFirst(userID: number): Effect.Effect<void, DbUnavailable>;
  replaceWith(userID: number): Effect.Effect<void, DbUnavailable>;
  remove(steps: RemovalSteps): Effect.Effect<void, DbUnavailable>;
}

export function makeConsent(storage: DeviceStorage["Service"]): Consent {
  const read = (key: string) =>
    storage.load(key).pipe(
      Effect.tapError((error) =>
        Effect.logWarning(
          "A device record of the online library is unreadable",
        ).pipe(Effect.annotateLogs({ key, error: error.message })),
      ),
      Effect.mapError(() => unavailable(m.settings_online_record_unreadable())),
    );
  const write = (key: string, value: unknown) =>
    storage
      .save(key, value)
      .pipe(
        Effect.mapError(() => unavailable(m.settings_online_record_unsaved())),
      );
  const current = Effect.map(read(CONSENTED_ACCOUNT_KEY), (raw) =>
    typeof raw === "number" && Number.isInteger(raw) ? raw : null,
  );
  const removalPending = Effect.map(
    read(PENDING_REMOVAL_KEY),
    (raw) => raw === true,
  );
  return {
    current,
    removalPending,
    grantFirst: Effect.fn("Consent.grantFirst")(function* (userID: number) {
      if (yield* removalPending) return;
      if ((yield* current) !== null) return;
      yield* write(CONSENTED_ACCOUNT_KEY, userID);
      yield* Effect.logInfo(
        "The online library downloads the libraries of the account of the key",
      );
    }),
    replaceWith: Effect.fn("Consent.replaceWith")(function* (userID: number) {
      yield* write(CONSENTED_ACCOUNT_KEY, userID);
      yield* Effect.logInfo(
        "The online library replaces the data with the libraries of the new account",
      );
    }),
    remove: Effect.fn("Consent.remove")(function* (steps: RemovalSteps) {
      yield* write(PENDING_REMOVAL_KEY, true).pipe(
        Effect.mapError(() =>
          unavailable(m.settings_online_remove_not_started()),
        ),
      );
      yield* Effect.gen(function* () {
        yield* steps.forgetKey;
        yield* write(CONSENTED_ACCOUNT_KEY, null);
        yield* steps.deleteReplica;
        yield* write(PENDING_REMOVAL_KEY, null);
      }).pipe(
        Effect.mapError(() =>
          unavailable(m.settings_online_remove_key_unsaved()),
        ),
      );
      yield* Effect.logInfo("The online library data was removed");
    }),
  };
}
