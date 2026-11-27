import { Effect, Redacted } from "effect";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

import { createFixtureSchema } from "@zotlit/db-testing";
import { exportWebApiLibraries } from "@zotlit/db-testing/web-api";
import { loadSqliteWasm } from "@zotlit/drizzle-sqlite-wasm";
import type { SqliteWasm } from "@zotlit/drizzle-sqlite-wasm";
import type { WebApiFetch } from "@zotlit/web-library";
import {
  crossOriginFetch,
  FakeZoteroApi,
} from "@zotlit/web-library/fake-zotero-api";
import {
  newApiKey,
  READ_ALL_ACCESS,
} from "@zotlit/web-library/fake-zotero-api/scenario";

import type { WebApiReadsConfig } from "#contract/rpc.ts";
import { layerWebApiSource } from "#worker/web-api-source.ts";
import type { WebApiSourceOptions } from "#worker/web-api-source.ts";

const require = createRequire(import.meta.url);
const wasm = readFileSync(
  require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"),
);

export const FAKE_API_URL = "http://zotero-api.test";

export interface SeededApi {
  readonly api: FakeZoteroApi;
  readonly key: string;
  readonly fetch: WebApiFetch;
}

export function fakeApiFetch(api: FakeZoteroApi): WebApiFetch {
  return crossOriginFetch((url, init) =>
    api.handle(new Request(url, init)),
  );
}

const EXPORTABLE_FIXTURE = `
  alter table collections add column version integer not null default 0;
  create table charsets (charsetID integer primary key, charset text);
  create view itemTypeFieldsCombined as
    select t.itemTypeID, f.fieldID, f.fieldID as orderIndex
    from itemTypes t cross join fieldsCombined f where f.custom = 0;
`;

export const ZOTERO_STORAGE_FORM = `
  update itemNotes set note = '<div class="zotero-note znv1">' || note || '</div>'
    where note not like '<div class="zotero-note znv%';
`;

export function seededApi(
  seed: string,
  account: { readonly userID: number; readonly username: string },
): SeededApi {
  const sqlite = new DatabaseSync(":memory:");
  try {
    createFixtureSchema(sqlite);
    sqlite.exec(EXPORTABLE_FIXTURE);
    sqlite.exec(seed);
    sqlite.exec(ZOTERO_STORAGE_FORM);
    const api = new FakeZoteroApi({ ...account, baseUrl: FAKE_API_URL });
    api.loadLibraries(exportWebApiLibraries(sqlite, account));
    const key = newApiKey();
    api.addKey(key, READ_ALL_ACCESS);
    return { api, key, fetch: fakeApiFetch(api) };
  } finally {
    sqlite.close();
  }
}

export function webApiConfig(
  key: string,
  patch: Partial<WebApiReadsConfig> = {},
): WebApiReadsConfig {
  return {
    source: "web-api",
    apiKey: Redacted.make(key),
    baseUrl: FAKE_API_URL,
    poolDirectory: "/zotlit/test",
    locale: null,
    chineseSegmenter: null,
    logLevel: null,
    consentedUserID: 42,
    ...patch,
  };
}

export const loadMemoryEngine = (): Promise<SqliteWasm> =>
  loadSqliteWasm({ wasm, storage: "memory" });

export interface CountedEngine {
  readonly engine: SqliteWasm;
  readonly opens: () => number;
}

export function keptEngine(engine: SqliteWasm): CountedEngine {
  let opens = 0;
  return {
    engine: {
      ...engine,
      open: (options) => {
        opens++;
        return engine.open(options);
      },
      close: () => undefined,
      [Symbol.dispose]: () => undefined,
    },
    opens: () => opens,
  };
}

export function keyOwner(seeded: Pick<SeededApi, "api" | "key">): number {
  const grant = seeded.api.keys.get(seeded.key);
  if (!grant) throw new Error("the fake Zotero API holds no grant for the key");
  return grant.userID;
}

export function memoryWebApiSource(
  seeded: SeededApi,
  options: Partial<WebApiSourceOptions> = {},
) {
  return layerWebApiSource({
    engine: Effect.promise(() => loadMemoryEngine()),
    fetch: seeded.fetch,
    initial: webApiConfig(seeded.key, { consentedUserID: keyOwner(seeded) }),
    ...options,
  });
}
