import "#test/inflate.ts";
import type { PdfEngine } from "#/core/index.ts";
import type { FixturePdf } from "#test/fixtures.ts";
import type { Inflation } from "#test/inflate.ts";

import { createPdfEngine, PdfLoadError } from "#/core/index.ts";
import { testFetchData } from "#test/data.ts";
import { fixturePdf } from "#test/fixtures.ts";
import { inflateSpy, inflations } from "#test/inflate.ts";

export interface EngineReport {
  readonly fonts: { readonly a: string[]; readonly b: string[] };
  readonly jbig2: PixelCounts;
  readonly jpx: PixelCounts;
  readonly failures: Readonly<Record<string, string>>;
  readonly interrupted: Interrupted;
  readonly assets: Assets;
}

interface Assets {
  readonly inflatesAtPluginLoad: number;
  readonly firstInflate: Inflation | undefined;
  readonly concurrentFirstLoads: {
    readonly workers: number;
    readonly inflates: number;
  };
}

interface Interrupted {
  readonly disposedDuringRead: string;
  readonly disposedDuringLoad: string;
  readonly abortedDuringLoad: string;
  readonly terminatedOnAbort: boolean;
  readonly loadAfterAbort: string;
  readonly currentAfterDispose: boolean;
}

interface PixelCounts {
  readonly width: number;
  readonly height: number;
  readonly dark: number;
  readonly gray: number;
  readonly white: number;
}

function source(name: FixturePdf) {
  return {
    key: name,
    name,
    read: async () => fixturePdf(name),
  };
}

function families(): Set<string> {
  return new Set(
    [...document.fonts].map((face) => face.family.replaceAll('"', "")),
  );
}

async function render(engine: PdfEngine, name: FixturePdf) {
  const loaded = await engine.load(source(name));
  const page = await loaded.page(0);
  if (!page) throw new Error(`${name} has no current page`);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return {
    canvas,
    [Symbol.asyncDispose]: () => loaded[Symbol.asyncDispose](),
  };
}

function count(canvas: HTMLCanvasElement): PixelCounts {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas context unavailable");
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let dark = 0;
  let gray = 0;
  let white = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = data[offset]!;
    if (value < 64) dark++;
    else if (value > 112 && value < 144) gray++;
    else if (value > 240) white++;
  }
  return { width: canvas.width, height: canvas.height, dark, gray, white };
}

async function outcome(load: Promise<unknown>): Promise<string> {
  const { promise: timeout, resolve } = Promise.withResolvers<string>();
  const timer = setTimeout(() => resolve("timeout"), 2000);
  try {
    return await Promise.race([
      load.then(
        () => "loaded",
        (error: unknown) =>
          error instanceof PdfLoadError ? error.reason : String(error),
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function failures(): Promise<Record<string, string>> {
  using engine = createPdfEngine({ idPrefix: "f", fetchData: testFetchData });
  const aborted = new AbortController();
  const abortedLoad = engine.load(source("sandve-2013/sandve-2013.pdf"), {
    signal: aborted.signal,
  });
  aborted.abort();
  const result = {
    unreadable: await outcome(
      engine.load({
        key: "missing",
        name: "missing",
        read: async () => {
          throw new Error("missing");
        },
      }),
    ),
    invalid: await outcome(
      engine.load(source("excerpt-rendering/corrupt.pdf")),
    ),
    passwordRequired: await outcome(
      engine.load(source("excerpt-rendering/encrypted.pdf")),
    ),
    passwordIncorrect: await outcome(
      engine.load(source("excerpt-rendering/encrypted.pdf"), {
        password: "not the password",
      }),
    ),
    aborted: await outcome(abortedLoad),
  };
  engine[Symbol.dispose]();
  return {
    ...result,
    afterDispose: await outcome(
      engine.load(source("sandve-2013/sandve-2013.pdf")),
    ),
  };
}

function watchPosts(onPost: (action: unknown) => void): Disposable {
  const original = globalThis.Worker;
  globalThis.Worker = class extends original {
    override postMessage(message: unknown, transfer?: unknown): void {
      super.postMessage(message, transfer as Transferable[]);
      if (
        typeof message === "object" &&
        message !== null &&
        "action" in message
      ) {
        onPost(message.action);
      }
    }
  };
  return {
    [Symbol.dispose]: () => {
      globalThis.Worker = original;
    },
  };
}

function countWorkers(): { readonly count: number } & Disposable {
  const original = globalThis.Worker;
  const counter = {
    count: 0,
    [Symbol.dispose]: () => {
      globalThis.Worker = original;
    },
  };
  globalThis.Worker = class extends original {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      counter.count++;
    }
  };
  return counter;
}

async function concurrentFirstLoads() {
  using engine = createPdfEngine({ idPrefix: "w", fetchData: testFetchData });
  using workers = countWorkers();
  const before = inflations.started;
  const loaded = await Promise.all([
    engine.load(source("sandve-2013/sandve-2013.pdf")),
    engine.load(source("sandve-2013/sandve-2013.pdf")),
  ]);
  for (const document of loaded) await document[Symbol.asyncDispose]();
  return { workers: workers.count, inflates: inflations.started - before };
}

async function disposedDuringRead(): Promise<string> {
  using engine = createPdfEngine({ idPrefix: "r", fetchData: testFetchData });
  const reading = Promise.withResolvers<void>();
  const bytes = Promise.withResolvers<Uint8Array>();
  const load = engine.load({
    key: "deferred",
    name: "deferred",
    read: () => {
      reading.resolve();
      return bytes.promise;
    },
  });
  await reading.promise;
  engine[Symbol.dispose]();
  bytes.resolve(fixturePdf("sandve-2013/sandve-2013.pdf"));
  return await outcome(load);
}

async function disposedDuringLoad(): Promise<string> {
  using engine = createPdfEngine({ idPrefix: "l", fetchData: testFetchData });
  using _posts = watchPosts((action) => {
    if (action === "Ready") queueMicrotask(() => engine[Symbol.dispose]());
  });
  return await outcome(engine.load(source("sandve-2013/sandve-2013.pdf")));
}

async function abortedDuringLoad() {
  using engine = createPdfEngine({ idPrefix: "c", fetchData: testFetchData });
  const aborted = new AbortController();
  const actions: unknown[] = [];
  using _posts = watchPosts((action) => {
    actions.push(action);
    if (action === "Ready") queueMicrotask(() => aborted.abort());
  });
  const abortedDuringLoad = await outcome(
    engine.load(source("sandve-2013/sandve-2013.pdf"), {
      signal: aborted.signal,
    }),
  );
  const terminatedOnAbort = actions.includes("Terminate");
  const again = engine.load(source("sandve-2013/sandve-2013.pdf"));
  const loadAfterAbort = await outcome(again);
  if (loadAfterAbort === "loaded") await (await again)[Symbol.asyncDispose]();
  return { abortedDuringLoad, terminatedOnAbort, loadAfterAbort };
}

async function currentAfterDispose(): Promise<boolean> {
  using engine = createPdfEngine({ idPrefix: "d", fetchData: testFetchData });
  const loaded = await engine.load(source("sandve-2013/sandve-2013.pdf"));
  engine[Symbol.dispose]();
  return loaded.current();
}

export async function run(): Promise<EngineReport> {
  using _spy = inflateSpy;
  using a = createPdfEngine({ idPrefix: "a", fetchData: testFetchData });
  using b = createPdfEngine({ idPrefix: "b", fetchData: testFetchData });
  const inflatesAtPluginLoad = inflations.started;
  const before = families();
  await using _first = await render(a, "sandve-2013/sandve-2013.pdf");
  const afterA = families();
  await using _second = await render(b, "sandve-2013/sandve-2013.pdf");
  const afterB = families();
  const fonts = {
    a: [...afterA].filter((family) => !before.has(family)),
    b: [...afterB].filter((family) => !afterA.has(family)),
  };
  await using jbig2 = await render(a, "pdf-reader/jbig2.pdf");
  await using jpx = await render(b, "pdf-reader/jpx.pdf");
  return {
    fonts,
    jbig2: count(jbig2.canvas),
    jpx: count(jpx.canvas),
    failures: await failures(),
    interrupted: {
      disposedDuringRead: await disposedDuringRead(),
      disposedDuringLoad: await disposedDuringLoad(),
      ...(await abortedDuringLoad()),
      currentAfterDispose: await currentAfterDispose(),
    },
    assets: {
      inflatesAtPluginLoad,
      firstInflate: inflations.finished[0],
      concurrentFirstLoads: await concurrentFirstLoads(),
    },
  };
}
