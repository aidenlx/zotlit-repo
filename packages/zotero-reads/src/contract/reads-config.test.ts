import { Redacted, Schema } from "effect";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";

import { ZOTERO_API_BASE_URL } from "@zotlit/web-library";

import { fileConfigOf, ReadsConfigSchema, ZOTERO_WEB_API_URL } from "./rpc.ts";

const KEY = "testkey0123456789abcdef";

const reader = { locale: null, chineseSegmenter: null, logLevel: null };

const fileConfig = {
  databasePath: "/zotero/zotero.sqlite",
  readMode: "auto",
  autoRefresh: true,
  ...reader,
} as const;

const webConfig = {
  source: "web-api",
  apiKey: KEY,
  poolDirectory: "/zotlit/vault",
  ...reader,
} as const;

const decode = Schema.decodeUnknownSync(ReadsConfigSchema);

describe("ReadsConfigSchema", () => {
  it("decodes a file configuration without a source, as before", () => {
    const config = decode(fileConfig);
    expect(config).toEqual(fileConfig);
    expect(fileConfigOf(config)).toEqual(fileConfig);
  });

  it("decodes a Web API configuration with the key as a redacted value and the default address", () => {
    const config = decode(webConfig);
    expect(config.source).toBe("web-api");
    expect(fileConfigOf(config)).toBeNull();
    if (config.source !== "web-api") throw new Error("not the Web API source");
    expect(Redacted.isRedacted(config.apiKey)).toBe(true);
    expect(Redacted.value(config.apiKey)).toBe(KEY);
    expect(config.baseUrl).toBe(ZOTERO_WEB_API_URL);
    expect(ZOTERO_WEB_API_URL).toBe(ZOTERO_API_BASE_URL);
  });

  it("prints no key in the decoded value, its JSON or a failed decode", () => {
    const config = decode(webConfig);
    expect(inspect(config, { depth: 5 })).not.toContain(KEY);
    expect(JSON.stringify(config)).not.toContain(KEY);
    expect(`${JSON.stringify({ config })}`).not.toContain(KEY);
    let failure: unknown;
    try {
      decode({ ...webConfig, poolDirectory: 42 });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeDefined();
    expect(String(failure)).not.toContain(KEY);
    expect(JSON.stringify(failure)).not.toContain(KEY);
  });

  it("encodes the key as its value for the Worker message", () => {
    const encoded = Schema.encodeSync(ReadsConfigSchema)(decode(webConfig));
    expect(encoded).toMatchObject({ source: "web-api", apiKey: KEY });
  });
});
