import { Effect } from "effect";
import type { SecretStorage } from "obsidian";
import * as v from "valibot";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { parseJson } from "@zotlit/plugin-kernel/zotero-http.ts";

const RECORD_ID = "zotlit-zotero-write-authorization";

const RECORD_VERSION = 1;

const recordSchema = v.object({
  version: v.pipe(v.number(), v.safeInteger()),
  serverID: v.string(),
  key: v.optional(v.string()),
  confirmed: v.optional(v.literal(true)),
});

type StoredRecord = v.InferOutput<typeof recordSchema>;

export interface WriteAuthorizationStore {
  read(serverID: string): Promise<string | null>;
  holdsUnconfirmed(serverID: string): Promise<boolean>;
  has(): Promise<boolean>;
  remember(serverID: string, key: string): Promise<void>;
  confirm(serverID: string): Promise<void>;
  forget(): Promise<void>;
}

export type SecretStore = Pick<SecretStorage, "getSecret" | "setSecret">;

export interface SecretWriteAuthorizationStoreDeps {
  secrets: SecretStore;
}

export class SecretWriteAuthorizationStore implements WriteAuthorizationStore {
  readonly #secrets: SecretStore;

  constructor({ secrets }: SecretWriteAuthorizationStoreDeps) {
    this.#secrets = secrets;
  }

  read(serverID: string): Promise<string | null> {
    const record = this.#record();
    if (record === null || record.key === undefined) {
      return Promise.resolve(null);
    }
    if (record.serverID !== serverID) {
      Effect.runSyncWith(logServices)(
        Effect.logDebug(
          "The remembered authorization names another Zotero database",
        ).pipe(
          Effect.annotateLogs({
            remembered: record.serverID,
            asked: serverID,
          }),
          withLogCategory("zotero-local-api", "write-authorization"),
        ),
      );
      return Promise.resolve(null);
    }
    if (record.confirmed !== true) return Promise.resolve(null);
    return Promise.resolve(record.key);
  }

  holdsUnconfirmed(serverID: string): Promise<boolean> {
    const record = this.#record();
    return Promise.resolve(
      record !== null &&
        record.key !== undefined &&
        record.serverID === serverID &&
        record.confirmed !== true,
    );
  }

  has(): Promise<boolean> {
    return Promise.resolve(this.#record()?.key !== undefined);
  }

  remember(serverID: string, key: string): Promise<void> {
    this.#secrets.setSecret(
      RECORD_ID,
      JSON.stringify({
        version: RECORD_VERSION,
        serverID,
        key,
        confirmed: true,
      }),
    );
    Effect.runSyncWith(logServices)(
      Effect.logDebug("Remembered a Zotero write authorization").pipe(
        Effect.annotateLogs({ serverID }),
        withLogCategory("zotero-local-api", "write-authorization"),
      ),
    );
    return Promise.resolve();
  }

  confirm(serverID: string): Promise<void> {
    const record = this.#record();
    if (record?.key === undefined || record.serverID !== serverID) {
      return Promise.resolve();
    }
    this.#secrets.setSecret(
      RECORD_ID,
      JSON.stringify({
        version: RECORD_VERSION,
        serverID,
        key: record.key,
        confirmed: true,
      }),
    );
    Effect.runSyncWith(logServices)(
      Effect.logDebug(
        "Confirmed the remembered Zotero write authorization",
      ).pipe(
        Effect.annotateLogs({ serverID }),
        withLogCategory("zotero-local-api", "write-authorization"),
      ),
    );
    return Promise.resolve();
  }

  forget(): Promise<void> {
    const record = this.#record();
    if (record === null) return Promise.resolve();
    this.#secrets.setSecret(
      RECORD_ID,
      JSON.stringify({ version: RECORD_VERSION, serverID: record.serverID }),
    );
    Effect.runSyncWith(logServices)(
      Effect.logDebug(
        "Invalidated the remembered Zotero write authorization",
      ).pipe(withLogCategory("zotero-local-api", "write-authorization")),
    );
    return Promise.resolve();
  }

  #record(): StoredRecord | null {
    let stored: string | null;
    try {
      stored = this.#secrets.getSecret(RECORD_ID);
    } catch (error) {
      Effect.runSyncWith(logServices)(
        Effect.logWarning("Obsidian's keychain refused to answer").pipe(
          Effect.annotateLogs({ error }),
          withLogCategory("zotero-local-api", "write-authorization"),
        ),
      );
      return null;
    }
    if (stored === null) return null;

    const parsed = v.safeParse(recordSchema, parseJson(stored));
    if (!parsed.success) {
      Effect.runSyncWith(logServices)(
        Effect.logWarning("The stored write authorization cannot be read").pipe(
          withLogCategory("zotero-local-api", "write-authorization"),
        ),
      );
      return null;
    }
    if (parsed.output.version !== RECORD_VERSION) {
      Effect.runSyncWith(logServices)(
        Effect.logDebug(
          "The stored write authorization is another record version",
        ).pipe(
          Effect.annotateLogs({
            version: parsed.output.version,
          }),
          withLogCategory("zotero-local-api", "write-authorization"),
        ),
      );
      return null;
    }
    return parsed.output;
  }
}
