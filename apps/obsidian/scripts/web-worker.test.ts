import { delay } from "@std/async";
import { Effect, Stream } from "effect";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { parseSync } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

import { workerQuery } from "@zotlit/query-views/__fixtures__/item-query/worker-query.ts";
import { visibleText } from "@zotlit/query-views/core/item-query/visible-text.ts";
import {
  QUERY_COMMAND,
  QUERY_SCHEMA_COMMAND,
} from "@zotlit/query-views/worker/item-query/contract.ts";
import type { QueryViewRequest } from "@zotlit/query-views/worker/item-query/query-view.ts";
import type { QueryJob } from "@zotlit/query-views/worker/item-query/worker-protocol.ts";
import { writePack } from "@zotlit/resource-pack/writer.ts";
import { openScenarioApi } from "@zotlit/web-library/fake-zotero-api/scenario";
import { startWebWorker } from "@zotlit/zotero-reads/client/web-worker.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";

import {
  builtModule,
  builtRoot,
  exported,
  floorConfig,
  floorOf,
  floorWasm,
  floorWorker,
  POST_FLOOR_APIS,
  ROOTS,
} from "./__fixtures__/floor-worker.ts";
import type { FloorFetch } from "./__fixtures__/floor-worker.ts";
import { checkLoads } from "./worker-loads.ts";

const PACK_URL = "https://pack.zotlit.test/main.js";

async function jiebaPack(): Promise<string> {
  const bytes = new Uint8Array(
    await readFile(
      fileURLToPath(
        new URL("jieba_rs_wasm_bg.wasm", import.meta.resolve("jieba-wasm/web")),
      ),
    ),
  );
  const pack = await writePack({
    entries: [
      {
        name: "chinese-segmenter",
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  });
  return new TextDecoder().decode(pack);
}

function withPack(api: FloorFetch, pack: string): FloorFetch {
  return {
    handle: (request) =>
      request.url === PACK_URL
        ? Promise.resolve(new Response(pack))
        : api.handle(request),
  };
}

const inflated = (base64: string) =>
  new Blob([inflateRawSync(Buffer.from(base64, "base64"))]);

const built = Promise.all(
  ROOTS.map(async (root) => inflated(exported(await builtModule(root)))),
).then(([source, temporal]) => ({ source: source!, temporal: temporal! }));

const plainTexts = Promise.all(
  ROOTS.map(async (root) =>
    exported(await builtModule({ ...root, form: "string" })),
  ),
).then(([source, temporal]) => ({ source: source!, temporal: temporal! }));

const sha256Of = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

const FLOOR_JOB = {
  vault: { name: "Floor", path: "/vaults/floor" },
  scope: MY_LIBRARY_SCOPE,
  attachmentPaths: { dataDir: "/zotero", baseAttachmentPath: null },
} as const;

function floorQuery(id: string, params: Record<string, string>): QueryJob {
  const query = workerQuery(params);
  return {
    schema: false,
    dataset: query.from,
    command: QUERY_COMMAND,
    query,
    id,
    ...FLOOR_JOB,
  };
}

const floorView = (id: string, view: QueryViewRequest): QueryJob => ({
  command: QUERY_COMMAND,
  schema: false,
  view,
  id,
  ...FLOOR_JOB,
});

const envelopeOf = (answer: { readonly answer: string }) =>
  JSON.parse(answer.answer) as {
    ok: boolean;
    returnedCount?: number;
    groups?: {
      value: unknown;
      count: number;
      rows: { indexedKey: string; values: Record<string, unknown> }[];
    }[];
    rows?: { indexedKey: string; values: Record<string, unknown> }[];
  };

const FOUR_VITE_BUILDS_UNDER_LOAD_MS = 60_000;

describe("the Web Worker root of main.js", () => {
  beforeAll(
    () => Promise.all([built, plainTexts]),
    FOUR_VITE_BUILDS_UNDER_LOAD_MS,
  );

  it("holds the built roots to one importScripts call of the piece URL and no require", async () => {
    const { source, temporal } = await plainTexts;
    const [root, piece] = ROOTS;
    const loads = (code: string) =>
      checkLoads(parseSync("worker.js", code).program, root!);
    expect(loads(source)).toEqual([]);
    expect(checkLoads(parseSync("piece.js", temporal).program, piece!)).toEqual(
      [],
    );
    const call =
      /(?<scope>[\w$]+)\.importScripts\(\k<scope>\.zotlitTemporalPiece\)/;
    expect(source).toMatch(call);
    const SCRIPTS = expect.stringContaining(
      "worker.js calls importScripts with another URL",
    );
    expect(
      loads(
        source.replace(
          call,
          '$<scope>.importScripts($<scope>.zotlitTemporalPiece, "extra.js")',
        ),
      ),
    ).toEqual([SCRIPTS]);
    expect(
      loads(
        source.replace(
          call,
          "$<scope>.importScripts(config.zotlitTemporalPiece)",
        ),
      ),
    ).toEqual([SCRIPTS]);
    expect(loads(`${source};require("node:fs");`)).toEqual([
      expect.stringContaining('worker.js requires "node:fs"'),
    ]);
  });

  it("syncs a library and answers each kind of read with the globals, statics, prototype methods and iterator helpers that Chrome 108 or Safari 16.4 lack removed", async () => {
    const code = await built;
    const floor = floorOf();
    const wasm = await floorWasm();
    using scenario = openScenarioApi();
    scenario.api.user.updateItem("ART2FULL", { title: "长江流域的城市化研究" });
    const pack = await jiebaPack();
    const answers = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const reads = yield* startWebWorker(
            { code, wasm: wasm.slice() },
            {
              config: floorConfig(scenario.key, "https://api.zotero.test"),
              storage: "memory",
              spawn: (url) =>
                floorWorker(url, floor, withPack(scenario.api, pack)),
            },
          );
          yield* reads.Refresh();
          const segmenter = yield* reads.CheckChineseSegmenter({
            binary: {
              url: PACK_URL,
              entry: "chinese-segmenter",
              version: "1.0.0",
            },
          });
          const chinese = yield* reads.SearchItems({
            libraryIDs: [1],
            query: "流域",
            limit: 5,
          });
          const status = yield* reads.SyncStatus();
          const libraries = yield* reads.Libraries({});
          const itemIDs = (yield* reads.ScopeItemIDs({
            kind: "literature-items",
            libraryID: 1,
          }))!;
          const refs = yield* Stream.runCollect(
            reads.ChildNoteRefs({ itemIDs }),
          );
          const paths = (yield* Stream.runCollect(
            reads.AttachmentPathIndex({}),
          )).flat();
          const sources = yield* reads.AttachmentSources({
            attachmentKeys: paths.map((attachment) => attachment.indexedKey),
          });
          const citations = yield* reads.CitationLookup({
            scope: null,
            citekeys: ["lovelace2020"],
            annotationKeys: sources.annotations.map((a) => a.indexedKey),
          });
          const hits = yield* reads.SearchItems({
            libraryIDs: [1],
            query: "a",
            limit: 5,
          });
          const snapshot = yield* reads.ItemSnapshot({
            selection: { library: { type: "personal" }, key: "ART2FULL" },
            provenance: { kind: "sample", id: "floor" },
          });
          const tags = yield* reads.TagNames({});
          const collections = yield* reads.CollectionPaths({ libraryIDs: [1] });
          const itemQuery = yield* reads.ItemQuery({
            job: floorQuery("floor-items", {
              filter:
                'date.year >= 1000 && tags.map(value.lower()).length >= 0 && title.lower().contains("")',
              formulas: '{"year":"date.year","next":"formula.year + 1"}',
              fields: "title,formula.next",
              sort: "-date,title",
              group: "itemType",
              limit: "all",
            }),
          });
          const suggesterView = yield* reads.ItemQuery({
            job: floorView("floor-suggester", {
              from: "annotations",
              filter: `${visibleText("text")}.lower().contains("a") || ${visibleText("comment")}.lower().contains("a")`,
              fields: ["type", "text", "comment", "color", "item.title"],
              sort: [{ field: "dateAdded", direction: "desc" }],
              limit: 50,
            }),
          });
          const collectionCounts = yield* reads.ItemQuery({
            job: floorView("floor-collections", {
              from: "items",
              fields: [],
              group: "collections[]",
              limit: null,
              libraries: {
                mode: "selected",
                libraries: [{ type: "personal" }],
              },
            }),
          });
          const customFields = yield* reads.ItemQuery({
            job: {
              command: QUERY_SCHEMA_COMMAND,
              schema: false,
              customFields: true,
              id: "floor-custom-fields",
              ...FLOOR_JOB,
            },
          });
          const attachmentQuery = yield* reads.ItemQuery({
            job: floorQuery("floor-attachments", {
              from: "attachments",
              fields: "title,path,exists",
              limit: "all",
            }),
          });
          yield* reads.Configure(
            floorConfig("revokedfloorkey000000000", "https://api.zotero.test"),
          );
          const failed = yield* Effect.exit(reads.Refresh());
          const failedStatus = yield* reads.SyncStatus();
          return {
            collections,
            failed,
            failedStatus,
            itemQuery,
            attachmentQuery,
            suggesterView,
            collectionCounts,
            customFields,
            segmenter,
            chinese,
            status,
            libraries,
            refs: refs.flat(),
            paths,
            sources,
            citations,
            hits,
            snapshot,
            tags,
          };
        }),
      ),
    );
    expect(Atomics.load(floor.requested, 0)).toBe(1);
    expect(answers.status).toMatchObject({ state: "ready", problem: null });
    expect(answers.libraries.length).toBeGreaterThan(1);
    expect(answers.refs.length).toBeGreaterThan(0);
    expect(answers.paths.length).toBeGreaterThan(0);
    expect(answers.sources.attachments.length).toBeGreaterThan(0);
    expect(answers.citations.citekeys.get("lovelace2020")).toMatchObject({
      kind: "unique",
    });
    expect(answers.hits.length).toBeGreaterThan(0);
    expect(answers.snapshot.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(answers.tags.length).toBeGreaterThan(0);
    expect(answers.collections.length).toBeGreaterThan(0);
    expect(answers.failed._tag).toBe("Failure");
    expect(answers.failedStatus).toMatchObject({
      state: "ready",
      problem: { _tag: "key-invalid" },
    });
    const items = envelopeOf(answers.itemQuery);
    expect(items).toMatchObject({ ok: true, returnedCount: 7 });
    expect(items.groups?.map(({ value, count }) => ({ value, count }))).toEqual(
      [
        { value: "book", count: 1 },
        { value: "bookSection", count: 2 },
        { value: "journalArticle", count: 4 },
      ],
    );
    expect(items.groups?.[0]?.rows).toEqual([
      {
        indexedKey: "BK2MNTH2",
        values: { title: "Methods for Everyone", "formula.next": 2020 },
      },
    ]);
    expect(
      answers.suggesterView.view?.kind === "result" &&
        answers.suggesterView.view.result.rows?.map((row) => row.indexedKey),
    ).toEqual(["ANN2LINK", "ANN2UNDR", "ANN2HGHT"]);
    expect(
      answers.collectionCounts.view?.kind === "result" &&
        answers.collectionCounts.view.result.groups?.map(({ value, count }) => [
          value,
          count,
        ]),
    ).toEqual([
      ["Teaching/Methods", 1],
      ["Thesis", 1],
      ["Thesis/Methods", 2],
      [null, 7],
    ]);
    expect(answers.customFields).toMatchObject({
      command: QUERY_SCHEMA_COMMAND,
      customFields: [],
    });
    const attachments = envelopeOf(answers.attachmentQuery);
    expect(attachments.ok).toBe(true);
    expect(attachments.rows?.length).toBeGreaterThan(0);
    expect(attachments.rows?.map((row) => row.values.exists)).toEqual(
      attachments.rows?.map(() => false),
    );
    expect(answers.segmenter).toMatchObject({ kind: "ready" });
    expect(answers.chinese.map((hit) => hit.item.key)).toContain("ART2FULL");
  }, 60_000);

  it("reports an opfs-sahpool storage that cannot install as a failed read", async () => {
    const code = await built;
    const wasm = await floorWasm();
    const error = await Effect.runPromise(
      Effect.scoped(
        startWebWorker(
          { code, wasm },
          {
            config: floorConfig(
              "unusedkey000000000000000",
              "http://127.0.0.1:9",
            ),
            spawn: (url) => floorWorker(url, floorOf()),
          },
        ).pipe(Effect.flatMap((client) => Effect.flip(client.Libraries({})))),
      ),
    );
    expect(error).toMatchObject({
      _tag: "DbUnavailable",
      message: "Missing required OPFS APIs.",
    });
  }, 30_000);

  it("on a host with Temporal, holds no polyfill code and requests no polyfill piece", async () => {
    const code = await built;
    const [worker, temporal] = await Promise.all(
      ROOTS.map((root) => builtRoot(root)),
    );
    const polyfill = (id: string) => /[\\/]temporal-polyfill[\\/]/.test(id);
    expect(temporal!.moduleIds.some(polyfill)).toBe(true);
    expect(worker!.moduleIds.filter(polyfill)).toEqual([]);
    const floor = floorOf(
      POST_FLOOR_APIS.filter(
        (api) => !("global" in api && api.global === "Temporal"),
      ),
    );
    const wasm = await floorWasm();
    const error = await Effect.runPromise(
      Effect.scoped(
        startWebWorker(
          { code, wasm },
          {
            config: floorConfig(
              "unusedkey000000000000000",
              "http://127.0.0.1:9",
            ),
            spawn: (url) => floorWorker(url, floor),
          },
        ).pipe(Effect.flatMap((client) => Effect.flip(client.Libraries({})))),
      ),
    );
    expect(error).toMatchObject({ _tag: "DbUnavailable" });
    expect(Atomics.load(floor.requested, 0)).toBe(0);
  }, 30_000);

  it("inflates the embedded texts of main.js to the bytes of the built roots", async () => {
    const code = await built;
    const texts = await plainTexts;
    expect(sha256Of(new Uint8Array(await code.source.arrayBuffer()))).toBe(
      sha256Of(texts.source),
    );
    expect(sha256Of(new Uint8Array(await code.temporal.arrayBuffer()))).toBe(
      sha256Of(texts.temporal),
    );
  });

  it("fails the first request and stops the Worker when the Temporal piece does not load", async () => {
    const code = await built;
    const floor = floorOf();
    const wasm = await floorWasm();
    using scenario = openScenarioApi();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const reads = yield* startWebWorker(
            {
              code: {
                ...code,
                temporal: new Blob(['throw new Error("No Temporal piece");']),
              },
              wasm,
            },
            {
              config: floorConfig(scenario.key, "https://api.zotero.test"),
              spawn: (url) => floorWorker(url, floor, scenario.api),
            },
          );
          const exit = yield* Effect.exit(reads.Libraries({}));
          const stopped = yield* Effect.promise(() =>
            Promise.race([
              floor.exited.promise.then(() => true),
              delay(5_000).then(() => false),
            ]),
          );
          return { exit, stopped };
        }),
      ),
    );
    expect(outcome.exit._tag).toBe("Failure");
    expect(
      String(outcome.exit._tag === "Failure" && outcome.exit.cause),
    ).toContain("WorkerReceiveError");
    expect(Atomics.load(floor.closed, 0)).toBe(1);
    expect(outcome.stopped).toBe(true);
  }, 30_000);

  it("starts each text with the licences of the packages it bundles", async () => {
    const texts = await plainTexts;
    const [sourceNotice, temporalNotice] = [texts.source, texts.temporal].map(
      (text) => text.slice(0, text.indexOf("*/\n(() => {")),
    );
    expect(sourceNotice).toMatch(
      /^@sqlite\.org\/sqlite-wasm \S+ \(Apache-2\.0\)$/m,
    );
    expect(sourceNotice).toContain("Apache License");
    expect(sourceNotice).toContain(
      "LICENSE for the sqlite3 WebAssembly/JavaScript APIs",
    );
    expect(texts.source.slice(sourceNotice!.length)).not.toContain("@preserve");
    expect(sourceNotice).toMatch(/^drizzle-orm \S+ \(Apache-2\.0\)$/m);
    expect(sourceNotice).toMatch(/^effect \S+ \(MIT\)$/m);
    expect(temporalNotice).toMatch(/^temporal-polyfill \S+ \(MIT\)$/m);
    expect(temporalNotice).toContain("Permission is hereby granted");
  });
});
