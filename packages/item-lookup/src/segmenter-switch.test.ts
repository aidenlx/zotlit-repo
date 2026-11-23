import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { makeSegmenterSwitch } from "./segmenter-switch.ts";
import { JIEBA_WASM_VERSION } from "./segmenter.ts";

const TITLE = "中华人民共和国宪法研究";
const ENTRY = "jieba_rs_wasm_bg.wasm";
const INVALID = { url: "invalid.zip", entry: ENTRY, version: "invalid" };
const VALID = { url: "valid.zip", entry: ENTRY, version: "valid" };

const jieba = readFileSync(
  new URL(ENTRY, import.meta.resolve("jieba-wasm/web")),
);

function segmenterSwitch() {
  const emptyModule = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  return makeSegmenterSwitch({
    read: ({ version }) =>
      Effect.succeed({
        bytes: version === VALID.version ? jieba : emptyModule,
        upstreamVersion: JIEBA_WASM_VERSION,
      }),
  });
}

it("keeps the working Chinese Segmenter active when a different binary arrives", async () => {
  const snapshots = await Effect.gen(function* () {
    const segmenter = segmenterSwitch();
    const before = yield* segmenter.resolve(VALID);
    const replacement = yield* segmenter.resolve(INVALID);
    return {
      status: yield* segmenter.status,
      words: (replacement ?? before)?.words(TITLE),
    };
  }).pipe(Effect.runPromise);

  expect(snapshots.status).toEqual({ kind: "ready", version: VALID.version });
  expect(snapshots.words).toContain("华人");
});

it("uses the first Chinese Segmenter when a different binary arrives after pack removal", async () => {
  const snapshots = await Effect.gen(function* () {
    const segmenter = segmenterSwitch();
    yield* segmenter.resolve(VALID);
    const fallback = yield* segmenter.resolve(null);
    const absent = yield* segmenter.status;
    const replacement = yield* segmenter.resolve(INVALID);
    return {
      absent,
      fallbackWords: fallback?.words(TITLE),
      status: yield* segmenter.status,
      words: replacement?.words(TITLE),
    };
  }).pipe(Effect.runPromise);

  expect(snapshots.absent).toEqual({ kind: "pack-absent" });
  expect(snapshots.fallbackWords).toBeDefined();
  expect(snapshots.fallbackWords).not.toContain("华人");
  expect(snapshots.status).toEqual({ kind: "ready", version: VALID.version });
  expect(snapshots.words).toContain("华人");
});

it("a matching recorded version starts the Chinese Segmenter", async () => {
  const segmenter = segmenterSwitch();
  const ready = await Effect.runPromise(segmenter.resolve(VALID));

  expect(await Effect.runPromise(segmenter.status)).toEqual({
    kind: "ready",
    version: VALID.version,
  });
  expect(ready?.words(TITLE)).toContain("华人");
});

it("a pack without a recorded version starts the Chinese Segmenter", async () => {
  const segmenter = makeSegmenterSwitch({
    read: () => Effect.succeed({ bytes: jieba, upstreamVersion: undefined }),
  });
  await Effect.runPromise(segmenter.resolve(VALID));

  expect(await Effect.runPromise(segmenter.status)).toEqual({
    kind: "ready",
    version: VALID.version,
  });
});

it("a pack built for a newer jieba-wasm asks for a ZotLit update", async () => {
  const segmenter = makeSegmenterSwitch({
    read: () => Effect.succeed({ bytes: jieba, upstreamVersion: "99.0.0" }),
  });

  expect(await Effect.runPromise(segmenter.resolve(VALID))).toBeUndefined();
  expect(await Effect.runPromise(segmenter.status)).toEqual({
    kind: "plugin-outdated",
  });
});

it("a mismatched pack after a working one falls back to Intl.Segmenter", async () => {
  let upstreamVersion: string = JIEBA_WASM_VERSION;
  const segmenter = makeSegmenterSwitch({
    read: () => Effect.succeed({ bytes: jieba, upstreamVersion }),
  });
  await Effect.runPromise(segmenter.resolve(VALID));
  expect(await Effect.runPromise(segmenter.status)).toEqual({
    kind: "ready",
    version: VALID.version,
  });

  upstreamVersion = "2.3.0";
  const fallback = await Effect.runPromise(
    segmenter.resolve(VALID, { reread: true }),
  );
  expect(await Effect.runPromise(segmenter.status)).toEqual({
    kind: "pack-outdated",
  });
  expect(fallback).toBeDefined();
  expect(fallback?.words(TITLE)).not.toContain("华人");
});
