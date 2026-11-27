import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { inspect } from "node:util";
import { describe, expect } from "vitest";

import { WebWorkerInitSchema } from "./web-worker-rpc.ts";

describe("WebWorkerInitSchema", () => {
  const key = "initmessagekey0123456789";
  const init = {
    wasm: new Uint8Array([0, 0x61, 0x73, 0x6d]),
    storage: "opfs-sahpool",
    config: {
      source: "web-api",
      apiKey: key,
      poolDirectory: "/zotlit/vault",
      locale: null,
      chineseSegmenter: null,
      logLevel: null,
    },
    logs: new MessageChannel().port2,
  };

  it("carries the key as its value and decodes it to a redacted value", () => {
    const decoded = Schema.decodeUnknownSync(WebWorkerInitSchema)(init);
    expect(inspect(decoded.config, { depth: 5 })).not.toContain(key);
    expect(JSON.stringify(decoded.config)).not.toContain(key);
    init.logs.close();
  });

  it.effect(
    "prints no key when a sibling field of the key does not decode",
    () =>
      Effect.gen(function* () {
        const failure = yield* Effect.exit(
          Schema.decodeUnknownEffect(WebWorkerInitSchema)({
            ...init,
            config: { ...init.config, poolDirectory: 7 },
          }),
        );
        expect(failure._tag).toBe("Failure");
        expect(String(failure)).not.toContain(key);
        expect(JSON.stringify(failure)).not.toContain(key);
        init.logs.close();
      }),
  );
});
