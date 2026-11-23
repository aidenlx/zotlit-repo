import type { WireTag } from "#core/zotero-local-api/wire.ts";
import type { ZoteroPrefSnapshot } from "#core/zotero-pref/service.ts";
import { DateTime, Effect, Layer, PubSub, Stream } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";

import { layerFakeFetch } from "@zotlit/plugin-kernel/__fixtures__/fake-fetch.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { layerZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import type { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import type { DbUpdated } from "@zotlit/protocol";

import { layerZoteroLocalApi, ZoteroLocalApi } from "./service.ts";

import { LocalServer } from "#core/local-server/service.ts";
import { ZoteroPref } from "#core/zotero-pref/service.ts";

export const SERVER_ID = "A8sf5Zsz8ySw";

export const ATTACHMENT_KEY = "RGRPDF24";

export const PORT = 61319;

const API_HEADERS: Readonly<Record<string, string>> = {
  "X-Zotero-Version": "10.0",
  "X-Zotero-Connector-API-Version": "3",
  "Zotero-API-Version": "3",
  "Zotero-Schema-Version": "44",
  "Zotero-Server-ID": SERVER_ID,
};

export interface WireAnnotation {
  key: string;
  version: number;
  type: string;
  color?: string;
  comment?: string;
  text?: string;
  pageLabel?: string;
  sortIndex: string;
  position: unknown;
  parentItem?: string;
  groupID?: number;
  tags?: readonly (string | WireTag)[];
  dateAdded?: string;
}

export const ROUGIER_ANNOTATIONS: readonly WireAnnotation[] = [
  {
    key: "PUPR5FG5",
    dateAdded: "2026-08-23T16:17:50Z",
    version: 11,
    type: "highlight",
    text: "Identify Your Message",
    color: "#2ea8e5",
    pageLabel: "1",
    sortIndex: "00000|002041|00170",
    position: { pageIndex: 0, rects: [[265.833, 611.202, 374.503, 620.019]] },
  },
  {
    key: "FDRFQ7C2",
    dateAdded: "2026-08-23T16:18:01Z",
    version: 12,
    type: "image",
    color: "#ffd400",
    pageLabel: "2",
    sortIndex: "00001|001860|00047",
    position: { pageIndex: 1, rects: [[48.75, 395.509, 570, 743.723]] },
  },
  {
    key: "K3JRFLFQ",
    dateAdded: "2026-08-23T16:18:11Z",
    version: 13,
    type: "underline",
    text: "Scientific visualization is classically defined as the process of graphically displaying scientific data.",
    color: "#ff6666",
    pageLabel: "1",
    sortIndex: "00000|000434|00180",
    position: {
      pageIndex: 0,
      rects: [
        [67.011, 612.638, 211.485, 620.77],
        [58.054, 601.98, 211.489, 610.112],
        [58.054, 591.321, 153.781, 599.454],
      ],
    },
  },
  {
    key: "HRK7BG32",
    dateAdded: "2026-08-23T16:18:18Z",
    version: 14,
    type: "text",
    comment: "Making figures is hard :(",
    color: "#a28ae5",
    pageLabel: "1",
    sortIndex: "00000|000191|00088",
    position: {
      pageIndex: 0,
      fontSize: 14,
      rotation: 0,
      rects: [[398.804, 685.107, 560.804, 702.107]],
    },
  },
  {
    key: "C94NJNYG",
    dateAdded: "2026-08-23T16:19:19Z",
    version: 15,
    type: "note",
    comment: "some text comment",
    color: "#ffd400",
    pageLabel: "1",
    sortIndex: "00000|003354|00170",
    position: { pageIndex: 0, rects: [[566.901, 598.393, 588.901, 620.393]] },
  },
  {
    key: "TYY6Z6ZF",
    dateAdded: "2026-08-23T16:20:09Z",
    version: 16,
    type: "ink",
    color: "#5fb236",
    pageLabel: "1",
    sortIndex: "00000|000040|00100",
    position: {
      pageIndex: 0,
      width: 2,
      paths: [[66.964, 674.348, 66.629, 673.26, 66.629, 672.214]],
    },
  },
  {
    key: "4PE492KU",
    dateAdded: "2026-08-23T16:20:12Z",
    version: 17,
    type: "ink",
    color: "#f19837",
    pageLabel: "1",
    sortIndex: "00000|000067|00104",
    position: {
      pageIndex: 0,
      width: 2,
      paths: [[203.571, 673.009, 204.45, 672.256, 205.266, 671.628]],
    },
  },
];

export interface ZoteroRequest {
  url: URL;
  headers: Headers;
  method: string;
  body: string | null;
}

export interface ChildrenRequest {
  key: string;
  groupID: number | null;
  start: number;
}

export interface ZoteroAnswers {
  root?: () => Response | Promise<Response>;
  children?: (request: ChildrenRequest) => Response | Promise<Response>;
  authorize?: (request: ZoteroRequest) => Response | Promise<Response>;
  item?: (request: ZoteroRequest) => Response | Promise<Response>;
  write?: (request: ZoteroRequest) => Response | Promise<Response>;
}

const ITEM_PATH = /^\/api\/(?:users|groups)\/\d+\/items\/[^/]+$/;

export function fakeZotero(answers: ZoteroAnswers = {}): {
  http: Layer.Layer<ZoteroHttp>;
  requests: ZoteroRequest[];
} {
  const requests: ZoteroRequest[] = [];
  const http = layerZoteroHttp.pipe(
    Layer.provide(
      layerFakeFetch(async (input, init) => {
        const url = new URL(String(input));
        const request: ZoteroRequest = {
          url,
          headers: new Headers(init?.headers),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        };
        requests.push(request);
        if (url.pathname === "/api/") return (answers.root ?? rootOk)();
        if (url.pathname === "/api/local/authorize") {
          const authorize =
            answers.authorize ?? (() => authorized({ remember: true }));
          return authorize(request);
        }
        if (url.pathname.endsWith("/children")) {
          const children = answers.children ?? (() => annotationPage([]));
          return children(childrenRequest(url));
        }
        const write = answers.write ?? (() => writeAccepted());
        if (
          answers.item &&
          request.method === "GET" &&
          ITEM_PATH.test(url.pathname)
        ) {
          return answers.item(request);
        }
        return write(request);
      }),
    ),
  );
  return { http, requests };
}

export function rootOk(
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response("Nothing to see here.", {
    status: 200,
    headers: { ...API_HEADERS, "Content-Type": "text/plain", ...headers },
  });
}

export function annotationPage(
  annotations: readonly WireAnnotation[],
  options: {
    total?: number;
    start?: number;
    parentItem?: string;
    serverID?: string;
  } = {},
): Response {
  const { total = annotations.length, start = 0 } = options;
  const parentItem = options.parentItem ?? ATTACHMENT_KEY;
  const next = start + annotations.length;
  const base = "http://127.0.0.1:61319/api/users/0/items/RGRPDF24/children";
  return new Response(
    JSON.stringify(annotations.map((it) => wireItem(it, parentItem))),
    {
      status: 200,
      headers: {
        ...API_HEADERS,
        ...(options.serverID !== undefined && {
          "Zotero-Server-ID": options.serverID,
        }),
        "Content-Type": "application/json",
        "Last-Modified-Version": "4",
        "Total-Results": String(total),
        Link: `<${base}?start=${next}>; rel="next"`,
      },
    },
  );
}

export function annotationItem(
  annotation: WireAnnotation,
  options: { parentItem?: string } = {},
): Response {
  const parentItem = options.parentItem ?? ATTACHMENT_KEY;
  return new Response(JSON.stringify(wireItem(annotation, parentItem)), {
    status: 200,
    headers: { ...API_HEADERS, "Content-Type": "application/json" },
  });
}

export function createAccepted(
  annotation: WireAnnotation,
  options: { parentItem?: string } = {},
): Response {
  const parentItem = options.parentItem ?? ATTACHMENT_KEY;
  return new Response(
    JSON.stringify({
      successful: { 0: wireItem(annotation, parentItem) },
      success: { 0: annotation.key },
      unchanged: {},
      failed: {},
    }),
    {
      status: 200,
      headers: {
        ...API_HEADERS,
        "Content-Type": "application/json",
        "Last-Modified-Version": String(annotation.version),
      },
    },
  );
}

export function createRefused(
  code = 400,
  message = "Invalid annotationSortIndex",
): Response {
  return new Response(
    JSON.stringify({
      successful: {},
      success: {},
      unchanged: {},
      failed: { 0: { key: "", code, message } },
    }),
    {
      status: 200,
      headers: { ...API_HEADERS, "Content-Type": "application/json" },
    },
  );
}

export function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

export function serverChanged(serverID = "Zzzz11119999"): Response {
  return new Response("Zotero-Server-ID does not match this server", {
    status: 412,
    headers: {
      ...API_HEADERS,
      "Zotero-Server-ID": serverID,
      "Content-Type": "text/plain",
    },
  });
}

export function unauthorized(): Response {
  return new Response(
    "API key required -- POST /api/local/authorize to obtain one",
    {
      status: 401,
      headers: {
        "X-Zotero-Version": "10.0",
        "Content-Type": "text/plain",
        "WWW-Authenticate": 'Zotero-API-Key realm="Zotero Local API"',
      },
    },
  );
}

export function rateLimited(
  options: { retryAfter?: number | null } = {},
): Response {
  const { retryAfter = 60 } = options;
  return new Response("Too many authorization requests", {
    status: 429,
    headers: {
      ...API_HEADERS,
      "Content-Type": "text/plain",
      ...(retryAfter !== null && { "Retry-After": String(retryAfter) }),
    },
  });
}

export function denied(): Response {
  return new Response('{"denied":true}', {
    status: 403,
    headers: { ...API_HEADERS, "Content-Type": "application/json" },
  });
}

export function authorized(
  options: { remember?: boolean; key?: string } = {},
): Response {
  const { remember = false } = options;
  const key =
    options.key ??
    (remember
      ? "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf"
      : "zaxj2JbsV79sbQDXS7REpa3Z3kRDIory");
  return new Response(JSON.stringify({ key, remember }), {
    status: 200,
    headers: { ...API_HEADERS, "Content-Type": "application/json" },
  });
}

export function writeAccepted(version = 5): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...API_HEADERS,
      "Last-Modified-Version": String(version),
      "Content-Length": "0",
    },
  });
}

export function keyRejected(): Response {
  return new Response("Invalid or expired API key", {
    status: 401,
    headers: {
      "X-Zotero-Version": "10.0",
      "Content-Type": "text/plain",
    },
  });
}

export function staleVersion(): Response {
  return new Response(
    "item has been modified since specified version (expected 4, found 7)",
    {
      status: 412,
      headers: { ...API_HEADERS, "Content-Type": "text/plain" },
    },
  );
}

export function staleVersionPatch(): Response {
  return new Response("item version mismatch: expected 0, found 2", {
    status: 412,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

export function writeTokenUsed(): Response {
  return new Response("Write token already used", {
    status: 412,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

export function inMemoryCredentials(
  initial: { serverID: string; key: string } | null = null,
) {
  let record: { serverID: string; key?: string } | null = initial && {
    ...initial,
  };
  const writes: ({ serverID: string; key?: string } | null)[] = [];
  return {
    get record() {
      return record;
    },
    writes,
    read: vi.fn((serverID: string) =>
      Promise.resolve(
        record && record.serverID === serverID ? (record.key ?? null) : null,
      ),
    ),
    has: vi.fn(() => Promise.resolve(record?.key !== undefined)),
    remember: vi.fn((serverID: string, key: string) => {
      record = { serverID, key };
      writes.push({ ...record });
      return Promise.resolve();
    }),
    forget: vi.fn(() => {
      if (record !== null) {
        record = { serverID: record.serverID };
        writes.push({ ...record });
      }
      return Promise.resolve();
    }),
  };
}

export function localApiDisabled(): Response {
  return new Response("Local API is not enabled", {
    status: 403,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

export function incompatibleZotero(): Response {
  return new Response("API version not implemented: 4", {
    status: 501,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

export function libraryReadOnly(): Response {
  return new Response("Write access denied", {
    status: 403,
    headers: { ...API_HEADERS, "Content-Type": "text/plain" },
  });
}

export function foreignServer(status = 404): Response {
  return new Response(status === 404 ? "404 Not Found" : "Server error", {
    status,
    headers: { "Content-Type": "text/plain; charset=UTF-8" },
  });
}

export function unreachable(): never {
  throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
}

export interface ClientOptions {
  key?: string;
  credentials?: ReturnType<typeof inMemoryCredentials>;
  confirmGrant?: () => boolean | Promise<boolean>;
}

export const NOW = DateTime.makeUnsafe("2026-09-16T15:52:21Z");

export const testClockAtNow = Layer.provideMerge(
  Layer.effectDiscard(TestClock.setTime(DateTime.toEpochMillis(NOW))),
  TestClock.layer(),
);

export async function localApiClient(
  answers: ZoteroAnswers = {},
  options: ClientOptions = {},
) {
  const { http, requests } = fakeZotero(answers);
  const stack = new AsyncDisposableStack();
  const dbUpdated = Effect.runSync(PubSub.unbounded<DbUpdated>());
  stack.defer(() => {
    Effect.runSync(PubSub.shutdown(dbUpdated));
  });
  const serverEvents = {
    emit: () => {
      PubSub.publishUnsafe(dbUpdated, { event: "db/updated" });
    },
  };
  const prefChanges = Effect.runSync(PubSub.unbounded<ZoteroPrefSnapshot>());
  stack.defer(() => {
    Effect.runSync(PubSub.shutdown(prefChanges));
  });
  const credentials =
    options.credentials ??
    inMemoryCredentials(
      options.key === undefined
        ? null
        : { serverID: SERVER_ID, key: options.key },
    );
  let snapshot: ZoteroPrefSnapshot = {
    state: "ready",
    prefs: new Map(),
    resolvedProfileDir: null,
    profileDirOverride: null,
    dataDirOverride: null,
    dataDir: "/Zotero",
    databasePath: "/Zotero/zotero.sqlite",
    sourceId: "fixture-source",
    acceptedSourceIds: ["fixture-source"],
    baseAttachmentPath: null,
    httpPort: PORT,
  };
  const zoteroPref = {
    get httpPort(): number | null {
      return snapshot.httpPort;
    },
    set httpPort(port: number | null) {
      snapshot = { ...snapshot, httpPort: port };
    },
  };
  const prefEvents = {
    emit: (_event: "resolved-changed") => {
      snapshot = { ...snapshot, prefs: new Map(snapshot.prefs) };
      PubSub.publishUnsafe(prefChanges, snapshot);
    },
  };
  const pref = stubService<ZoteroPref["Service"]>("ZoteroPref", {
    current: Effect.sync(() => snapshot),
    changes: Stream.concat(
      Stream.succeed(snapshot),
      Stream.fromPubSub(prefChanges),
    ),
  });
  const server = stubService<LocalServer["Service"]>("LocalServer", {
    dbUpdated: Stream.fromPubSub(dbUpdated),
  });
  const localApiLayer = layerZoteroLocalApi({
    credentials,
    confirmGrant: Effect.promise(async () => options.confirmGrant?.() ?? true),
  }).pipe(
    Layer.provideMerge(testClockAtNow),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ZoteroPref, pref),
        Layer.succeed(LocalServer, server),
        http,
      ),
    ),
  );
  const runtime = buildRuntime(localApiLayer, stack);
  await runtime.context();
  const service = runtime.runSync(ZoteroLocalApi);
  const bridge = effectBridge(runtime);
  return {
    disposable: { [Symbol.asyncDispose]: () => stack.disposeAsync() },
    service,
    runtime,
    bridge,
    requests,
    credentials,
    zoteroPref,
    prefEvents,
    serverEvents,
  };
}

export function freshnessSignal(
  serverEvents: Awaited<ReturnType<typeof localApiClient>>["serverEvents"],
): void {
  serverEvents.emit();
}

function wireItem(
  annotation: WireAnnotation,
  parentItem: string,
): Record<string, unknown> {
  const library =
    annotation.groupID === undefined
      ? { type: "user", id: 0, name: "My Library" }
      : { type: "group", id: annotation.groupID, name: "Shared" };
  return {
    key: annotation.key,
    version: annotation.version,
    library,
    data: {
      key: annotation.key,
      version: annotation.version,
      itemType: "annotation",
      parentItem: annotation.parentItem ?? parentItem,
      annotationType: annotation.type,
      ...(annotation.text !== undefined && { annotationText: annotation.text }),
      annotationComment: annotation.comment ?? "",
      ...(annotation.color !== undefined && {
        annotationColor: annotation.color,
      }),
      annotationPageLabel: annotation.pageLabel ?? "",
      annotationSortIndex: annotation.sortIndex,
      annotationPosition: JSON.stringify(annotation.position),
      ...(annotation.dateAdded !== undefined && {
        dateAdded: annotation.dateAdded,
      }),
      ...(annotation.tags !== undefined && {
        tags: annotation.tags.map((tag) =>
          typeof tag === "string" ? { tag } : tag,
        ),
      }),
    },
  };
}

function childrenRequest(url: URL): ChildrenRequest {
  const parts = url.pathname.split("/");
  return {
    key: parts[5] ?? "",
    groupID: parts[2] === "groups" ? Number(parts[3]) : null,
    start: Number(url.searchParams.get("start") ?? 0),
  };
}
