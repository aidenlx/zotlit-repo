import { openParityPair, PARITY_USER } from "@zotlit/db/replica/parity-pair";
import type { ParityPair } from "@zotlit/db/replica/parity-pair";
import type { WebApiKey } from "@zotlit/zotero-types/web-api";

import { FakeZoteroApi } from "./fake-zotero-api.ts";

export const READ_ALL_ACCESS: WebApiKey["access"] = {
  user: { library: true, notes: true, files: true, write: false },
  groups: { all: { library: true, write: false } },
};

export interface ScenarioApi extends Disposable {
  readonly api: FakeZoteroApi;
  readonly key: string;
  readonly pair: ParityPair;
}

export function newApiKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function openScenarioApi(
  access: WebApiKey["access"] = READ_ALL_ACCESS,
): ScenarioApi {
  const pair = openParityPair();
  const api = new FakeZoteroApi(PARITY_USER);
  api.loadLibraries(pair.records);
  const key = newApiKey();
  api.addKey(key, access);
  return { api, key, pair, [Symbol.dispose]: () => pair[Symbol.dispose]() };
}
