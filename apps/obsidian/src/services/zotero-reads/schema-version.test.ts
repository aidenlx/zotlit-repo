import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

import { FakeZoteroApi } from "@zotlit/web-library/fake-zotero-api";

import { readServerSchemaVersion } from "./schema-version.ts";

const BASE = "http://zotero-api.test";

function sendTo(api: FakeZoteroApi, sizes: number[]) {
  return async (param: RequestUrlParam): Promise<RequestUrlResponse> => {
    const response = await api.handle(
      new Request(param.url, {
        method: param.method,
        headers: param.headers,
      }),
    );
    const arrayBuffer = await response.arrayBuffer();
    sizes.push(arrayBuffer.byteLength);
    const answer: RequestUrlResponse = {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      arrayBuffer,
      json: null,
      text: "",
    };
    return answer;
  };
}

it.effect(
  "reads the schema version of the Zotero server with one key-free HEAD request and no answer body",
  () =>
    Effect.gen(function* () {
      const api = new FakeZoteroApi({
        userID: 42,
        username: "reader",
        baseUrl: BASE,
      });
      api.schemaVersion = 99;
      const sizes: number[] = [];
      expect(yield* readServerSchemaVersion(sendTo(api, sizes), BASE)).toBe(99);
      expect(api.requests).toMatchObject([
        { method: "HEAD", path: "/itemTypes", key: "absent" },
      ]);
      expect(sizes).toEqual([0]);
    }),
);

it.effect("reads no schema version from an answer that is not a success", () =>
  Effect.gen(function* () {
    const api = new FakeZoteroApi({
      userID: 42,
      username: "reader",
      baseUrl: BASE,
    });
    api.schemaVersion = 99;
    const sizes: number[] = [];
    expect(
      yield* readServerSchemaVersion(sendTo(api, sizes), `${BASE}/missing`),
    ).toBeNull();
    expect(api.requests.map((request) => request.status)).toEqual([400]);
  }),
);
