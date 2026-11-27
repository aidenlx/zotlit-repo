import { Redacted } from "effect";
import { resolveObjectURL } from "node:buffer";
import { readFile } from "node:fs/promises";
import { MessageChannel, Worker as NodeWorker } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";

import type { StartWebWorkerOptions } from "@zotlit/zotero-reads/client/web-worker.ts";
import { PARITY_USER } from "@zotlit/db/replica/parity-pair";
import type { WebApiReadsConfig } from "@zotlit/zotero-reads/contract/rpc.ts";

import { embeddedWorker } from "../embedded-worker.ts";
import type { EmbeddedWorkerOptions } from "../embedded-worker.ts";
import { webWorkerRoots } from "../web-worker.ts";

export type PostFloorApi =
  | { readonly global: string }
  | { readonly static: string; readonly of: string }
  | { readonly method: string; readonly of: string }
  | { readonly iteratorHelper: string };

const statics = (of: string, names: readonly string[]): PostFloorApi[] =>
  names.map((name) => ({ static: name, of }));
const methods = (of: string, names: readonly string[]): PostFloorApi[] =>
  names.map((name) => ({ method: name, of }));

export const POST_FLOOR_APIS: readonly PostFloorApi[] = [
  { global: "Temporal" },
  { global: "DisposableStack" },
  { global: "AsyncDisposableStack" },
  { global: "SuppressedError" },
  { global: "Float16Array" },
  ...statics("Promise", ["withResolvers", "try"]),
  ...statics("Array", ["fromAsync"]),
  ...statics("Object", ["groupBy"]),
  ...statics("Map", ["groupBy"]),
  ...statics("Error", ["captureStackTrace", "isError"]),
  ...statics("RegExp", ["escape"]),
  ...statics("Math", ["f16round", "sumPrecise"]),
  ...statics("JSON", ["rawJSON", "isRawJSON"]),
  ...statics("Uint8Array", ["fromBase64", "fromHex"]),
  ...statics("URL", ["canParse", "parse"]),
  ...statics("AbortSignal", ["any", "timeout"]),
  ...statics("Atomics", ["pause"]),
  ...statics("Iterator", ["from"]),
  { global: "Iterator" },
  ...methods("Array", ["toSorted", "toReversed", "toSpliced", "with"]),
  ...methods("String", ["isWellFormed", "toWellFormed"]),
  ...methods("Set", [
    "union",
    "intersection",
    "difference",
    "symmetricDifference",
    "isSubsetOf",
    "isSupersetOf",
    "isDisjointFrom",
  ]),
  ...methods("Map", ["getOrInsert", "getOrInsertComputed"]),
  ...methods("ArrayBuffer", ["transfer", "transferToFixedLength", "detached"]),
  ...methods("Uint8Array", [
    "toBase64",
    "toHex",
    "setFromBase64",
    "setFromHex",
  ]),
  ...methods("ReadableStream", ["values", "Symbol.asyncIterator"]),
  ...[
    "map",
    "filter",
    "take",
    "drop",
    "flatMap",
    "reduce",
    "toArray",
    "forEach",
    "some",
    "every",
    "find",
    "Symbol.dispose",
  ].map((name) => ({ iteratorHelper: name })),
];

const FLOOR_ERROR = "floor-uncaught-error";

const FLOOR_THREAD = `
const { parentPort, workerData } = require("node:worker_threads");
const { runInThisContext } = require("node:vm");
const FLOOR_ERROR = ${JSON.stringify(FLOOR_ERROR)};
function loadNodeLazyGlobals() {
  for (const name of ["fetch", "Request", "Response", "Headers", "FormData", "WebSocket", "EventSource", "navigator", "crypto", "performance", "structuredClone", "BroadcastChannel", "Blob", "ReadableStream", "CompressionStream", "DecompressionStream", "TextEncoderStream"]) Reflect.get(globalThis, name);
}
const keyOf = (name) => name.startsWith("Symbol.") ? Symbol[name.slice(7)] : name;
function ownerOf(api) {
  if ("global" in api) return [globalThis, api.global];
  if ("static" in api) return [globalThis[api.of], api.static];
  if ("method" in api) return [globalThis[api.of].prototype, api.method];
  return [Object.getPrototypeOf(Object.getPrototypeOf([].values())), api.iteratorHelper];
}
function removePostFloorApis(apis) {
  for (const api of apis) {
    const [owner, name] = ownerOf(api);
    if (owner) delete owner[keyOf(name)];
  }
  const left = apis.filter((api) => { const [owner, name] = ownerOf(api); return owner && keyOf(name) in owner; });
  if (left.length > 0) throw new Error("post-floor APIs still present: " + JSON.stringify(left));
}
loadNodeLazyGlobals();
// A browser reports an unhandled rejection of a Worker to no listener of the host.
process.on("unhandledRejection", () => {});
const fetchPort = workerData.fetchPort;
if (fetchPort) {
  const pending = new Map();
  let nextRequest = 0;
  fetchPort.on("message", ({ id, status, headers, body }) => {
    const resolve = pending.get(id);
    pending.delete(id);
    resolve({
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      text: async () => body,
      body: streamOf(new TextEncoder().encode(body)),
    });
  });
  const streamOf = (bytes) => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  const DATA_BASE64 = /^data:[^,]*;base64,/;
  globalThis.fetch = (url, init) => DATA_BASE64.test(String(url))
    ? Promise.resolve({ status: 200, headers: { get: () => null }, body: streamOf(Uint8Array.from(atob(String(url).replace(DATA_BASE64, "")), (c) => c.charCodeAt(0))) })
    : new Promise((resolve) => {
    const id = nextRequest++;
    pending.set(id, resolve);
    fetchPort.postMessage({ id, url: String(url), method: init?.method ?? "GET", headers: { ...init?.headers } });
  });
}
// Node's own Response (undici) calls Promise.withResolvers, so the floor gives a Response that reads its stream.
globalThis.Response = class {
  constructor(body) { this.body = body; }
  async arrayBuffer() {
    const chunks = [];
    const reader = this.body.getReader();
    for (let read = await reader.read(); !read.done; read = await reader.read()) chunks.push(read.value);
    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let filled = 0;
    for (const chunk of chunks) { bytes.set(chunk, filled); filled += chunk.length; }
    return bytes.buffer;
  }
};
removePostFloorApis(workerData.apis);
const listeners = new Map();
globalThis.self = globalThis;
globalThis.location = { href: "blob:node-floor-check" };
globalThis.addEventListener = (type, listener) => {
  if (type !== "message") return;
  const wrapped = (data) => listener({ data });
  listeners.set(listener, wrapped);
  parentPort.on("message", wrapped);
};
globalThis.removeEventListener = (type, listener) => {
  const wrapped = listeners.get(listener);
  if (wrapped) parentPort.off("message", wrapped);
};
globalThis.postMessage = (message, options) =>
  parentPort.postMessage(message, Array.isArray(options) ? options : options?.transfer);
// A browser reports an uncaught error of a Worker to the host and keeps the Worker running.
process.on("uncaughtException", (error) =>
  parentPort.postMessage({ [FLOOR_ERROR]: String(error?.message ?? error) }),
);
const requested = new Int32Array(workerData.requested);
const closed = new Int32Array(workerData.closed);
globalThis.close = () => {
  Atomics.add(closed, 0, 1);
  parentPort.close();
  fetchPort?.close();
};
globalThis.importScripts = (...urls) => {
  for (const url of urls) {
    Atomics.add(requested, 0, 1);
    runInThisContext(workerData.scripts[url]);
  }
};
runInThisContext(workerData.source);
`;

export type HostWorker = ReturnType<NonNullable<StartWebWorkerOptions["spawn"]>>;

export interface FloorFetch {
  readonly handle: (request: Request) => Promise<Response>;
}

export interface Floor {
  readonly apis: readonly PostFloorApi[];
  readonly requested: Int32Array<SharedArrayBuffer>;
  readonly closed: Int32Array<SharedArrayBuffer>;
  readonly exited: PromiseWithResolvers<void>;
}

export const floorOf = (apis: readonly PostFloorApi[] = POST_FLOOR_APIS): Floor => ({
  apis,
  requested: new Int32Array(new SharedArrayBuffer(4)),
  closed: new Int32Array(new SharedArrayBuffer(4)),
  exited: Promise.withResolvers<void>(),
});

async function blobText(url: string): Promise<string> {
  const blob = resolveObjectURL(url);
  if (!blob) throw new Error(`No Blob at ${url}`);
  return blob.text();
}

const PIECE_URL = /^self\[[^\]]+\] = "(?<url>[^"]+)";/;

async function floorThread(
  url: string,
  floor: Floor,
  fetchPort: MessagePort | undefined,
): Promise<NodeWorker> {
  const source = await blobText(url);
  const piece = PIECE_URL.exec(source)?.groups?.url;
  const scripts = piece ? { [piece]: await blobText(piece) } : {};
  return new NodeWorker(FLOOR_THREAD, {
    eval: true,
    workerData: {
      source,
      scripts,
      requested: floor.requested.buffer,
      closed: floor.closed.buffer,
      apis: floor.apis,
      fetchPort,
    },
    transferList: fetchPort ? [fetchPort] : [],
  });
}

const uncaughtOf = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && FLOOR_ERROR in value
    ? String((value as Record<string, unknown>)[FLOOR_ERROR])
    : undefined;


export function floorWorker(url: string, floor: Floor, api?: FloorFetch): HostWorker {
  const channel = api ? new MessageChannel() : undefined;
  const relay = async (request: {
    id: number;
    url: string;
    method: string;
    headers: Record<string, string>;
  }) => {
    const response = await api!.handle(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
      }),
    );
    channel!.port1.postMessage({
      id: request.id,
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  };
  channel?.port1.on("message", (request: Parameters<typeof relay>[0]) => {
    void relay(request);
  });
  const thread = floorThread(url, floor, channel?.port2);
  void thread.then((started) =>
    started.on("exit", () => {
      channel?.port1.close();
      floor.exited.resolve();
    }),
  );
  const attached = new Map<unknown, (value: unknown) => void>();
  return {
    postMessage: (
      message: unknown,
      options?: { transfer?: unknown[] } | unknown[],
    ) =>
      void thread.then((started) =>
        started.postMessage(
          message,
          (Array.isArray(options) ? options : options?.transfer) as never,
        ),
      ),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      const wrapped = (value: unknown) => {
        const uncaught = uncaughtOf(value);
        if (type === "message" && uncaught === undefined)
          listener({ data: value });
        else if (type === "error" && uncaught !== undefined)
          listener({ error: new Error(uncaught), message: uncaught });
        else if (type === "error" && value instanceof Error)
          listener({ error: value, message: value.message });
      };
      attached.set(listener, wrapped);
      void thread.then((started) => {
        started.on(type, wrapped);
        if (type === "error") started.on("message", wrapped);
      });
    },
    removeEventListener: (type: string, listener: unknown) => {
      const wrapped = attached.get(listener);
      if (wrapped)
        void thread.then((started) => {
          started.off(type, wrapped);
          started.off("message", wrapped);
        });
    },
    terminate: () => void thread.then((started) => started.terminate()),
  } as unknown as HostWorker;
}

export const ROOTS = webWorkerRoots("production");

export async function builtRoot(
  options: EmbeddedWorkerOptions,
): Promise<{ readonly module: string; readonly moduleIds: string[] }> {
  const load = embeddedWorker(options).load as (
    this: unknown,
    id: string,
  ) => Promise<string>;
  const moduleIds: string[] = [];
  const module = await load.call(
    {
      addWatchFile: (id: string) => moduleIds.push(id),
      error: (message: string) => {
        throw new Error(message);
      },
    },
    `\0${options.id}`,
  );
  return { module, moduleIds };
}

export const builtModule = async (options: EmbeddedWorkerOptions) =>
  (await builtRoot(options)).module;

export const exported = (module: string) =>
  JSON.parse(
    module.replace(/^export default (\(\) => )?/, "").replace(/;$/, ""),
  ) as string;

export const floorConfig = (key: string, baseUrl: string): WebApiReadsConfig => ({
  source: "web-api",
  apiKey: Redacted.make(key),
  baseUrl,
  poolDirectory: "/zotlit/floor",
  locale: null,
  chineseSegmenter: null,
  logLevel: null,
  consentedUserID: PARITY_USER.userID,
});

export const floorWasm = async (): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(
    await readFile(
      new URL(
        "../../node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm",
        import.meta.url,
      ),
    ),
  );
