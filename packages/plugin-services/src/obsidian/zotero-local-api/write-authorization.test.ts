import { expect, it } from "vitest";

import { SecretWriteAuthorizationStore } from "./write-authorization.ts";
import type { SecretStore } from "./write-authorization.ts";

const SERVER_ID = "A8sf5Zsz8ySw";
const OTHER_SERVER_ID = "Zzzz11119999";
const KEY = "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf";

const RECORD_ID = "zotlit-zotero-write-authorization";

it("keeps one record under the id ADR 0037 names, bound to the granting server", async () => {
  const { store, secrets } = setup();

  await store.remember(SERVER_ID, KEY);

  expect([...secrets.keys()]).toEqual([RECORD_ID]);
  expect(JSON.parse(secrets.get(RECORD_ID)!)).toEqual({
    version: 1,
    serverID: SERVER_ID,
    key: KEY,
    confirmed: true,
  });
  expect(await store.read(SERVER_ID)).toBe(KEY);
  expect(await store.has()).toBe(true);
});

it("holds a key saved without confirmation unused until it is confirmed", async () => {
  const { store, secrets } = setup({
    version: 1,
    serverID: SERVER_ID,
    key: KEY,
  });

  expect(await store.read(SERVER_ID)).toBeNull();
  expect(await store.has()).toBe(true);
  expect(await store.holdsUnconfirmed(SERVER_ID)).toBe(true);
  expect(await store.holdsUnconfirmed(OTHER_SERVER_ID)).toBe(false);

  await store.confirm(SERVER_ID);

  expect(JSON.parse(secrets.get(RECORD_ID)!)).toEqual({
    version: 1,
    serverID: SERVER_ID,
    key: KEY,
    confirmed: true,
  });
  expect(await store.read(SERVER_ID)).toBe(KEY);
  expect(await store.holdsUnconfirmed(SERVER_ID)).toBe(false);
});

it("confirms nothing for another Zotero database or a keyless record", async () => {
  const other = setup({ version: 1, serverID: SERVER_ID, key: KEY });
  const keyless = setup({ version: 1, serverID: SERVER_ID });

  await other.store.confirm(OTHER_SERVER_ID);
  await keyless.store.confirm(SERVER_ID);

  expect(JSON.parse(other.secrets.get(RECORD_ID)!)).toEqual({
    version: 1,
    serverID: SERVER_ID,
    key: KEY,
  });
  expect(JSON.parse(keyless.secrets.get(RECORD_ID)!)).toEqual({
    version: 1,
    serverID: SERVER_ID,
  });
});

it("reads the record fresh, so one deleted in the Keychain is gone at once", async () => {
  const { store, secrets } = setup({
    version: 1,
    serverID: SERVER_ID,
    key: KEY,
    confirmed: true,
  });

  expect(await store.read(SERVER_ID)).toBe(KEY);
  secrets.delete(RECORD_ID);

  expect(await store.read(SERVER_ID)).toBeNull();
  expect(await store.has()).toBe(false);
});

it("answers no key for another Zotero database, and leaves the record alone", async () => {
  const { store, secrets } = setup({
    version: 1,
    serverID: SERVER_ID,
    key: KEY,
    confirmed: true,
  });

  expect(await store.read(OTHER_SERVER_ID)).toBeNull();

  expect(JSON.parse(secrets.get(RECORD_ID)!).key).toBe(KEY);
  expect(await store.read(SERVER_ID)).toBe(KEY);
});

it("invalidates by overwriting the record without a key", async () => {
  const { store, secrets } = setup({
    version: 1,
    serverID: SERVER_ID,
    key: KEY,
    confirmed: true,
  });

  await store.forget();

  expect(JSON.parse(secrets.get(RECORD_ID)!)).toEqual({
    version: 1,
    serverID: SERVER_ID,
  });
  expect(await store.read(SERVER_ID)).toBeNull();
  expect(await store.has()).toBe(false);
});

it("writes nothing when there is nothing to invalidate", async () => {
  const { store, secrets } = setup();

  await store.forget();

  expect([...secrets.keys()]).toEqual([]);
});

it("reads a record of an unknown version, or an unreadable one, as no record", async () => {
  const laterVersion = setup({ version: 2, serverID: SERVER_ID, key: KEY });
  const unreadable = setup();
  unreadable.secrets.set(RECORD_ID, "not json");

  expect(await laterVersion.store.read(SERVER_ID)).toBeNull();
  expect(await laterVersion.store.has()).toBe(false);
  expect(await unreadable.store.read(SERVER_ID)).toBeNull();
});

it("reads a keystore that throws as no record", async () => {
  const store = new SecretWriteAuthorizationStore({
    secrets: {
      getSecret: () => {
        throw new Error("The keychain is locked");
      },
      setSecret: () => undefined,
    },
  });

  expect(await store.read(SERVER_ID)).toBeNull();
});

function setup(record?: unknown) {
  const secrets = new Map<string, string>();
  if (record !== undefined) secrets.set(RECORD_ID, JSON.stringify(record));
  const port: SecretStore = {
    getSecret: (id) => secrets.get(id) ?? null,
    setSecret: (id, secret) => {
      secrets.set(id, secret);
    },
  };
  return {
    store: new SecretWriteAuthorizationStore({ secrets: port }),
    secrets,
  };
}
