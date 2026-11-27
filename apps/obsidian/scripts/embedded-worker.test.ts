import { regex } from "arkregex";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import { RUNTIMES } from "@zotlit/scripts/runtime-table";
import type { Runtime } from "@zotlit/scripts/runtime-table";

import type { EmbeddedWorkerOptions } from "./embedded-worker.ts";
import { embeddedWorker } from "./embedded-worker.ts";

const ID = "virtual:scheduler-worker";

async function emptyManifest(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zt-licences-"));
  const file = join(dir, "manifest.json");
  await writeFile(file, "[]");
  return file;
}

const DECLARED_NAME = regex("^[\\p{ID_Start}$_][\\p{ID_Continue}$]*$", "u");

async function workerModule(
  minify: boolean,
  form?: "string" | "deflated",
  {
    fixture = "scheduler-worker.ts",
    runtime = RUNTIMES.desktopWorker,
    notices,
  }: {
    fixture?: string;
    runtime?: Runtime;
    notices?: EmbeddedWorkerOptions["notices"];
  } = {},
): Promise<string> {
  const plugin = embeddedWorker({
    id: ID,
    entry: resolve(import.meta.dirname, "__fixtures__", fixture),
    runtime,
    form,
    notices,
    config: {
      mode: "production",
      define: {},
      minify,
      sourcemap: false,
      target: "es2025",
    },
  });
  const load = plugin.load as (this: unknown, id: string) => Promise<string>;
  return load.call(
    {
      addWatchFile: () => {},
      error: (message: string) => {
        throw new Error(message);
      },
    },
    `\0${ID}`,
  );
}

async function workerSource(minify: boolean): Promise<string> {
  const module = await workerModule(minify);
  return JSON.parse(
    module.replace(/^export default /, "").replace(/;$/, ""),
  ) as string;
}

describe("embeddedWorker", () => {
  it.each([false, true])(
    "keeps the bundle's declarations off the worker global (minify: %s)",
    async (minify) => {
      const source = await workerSource(minify);
      const hostSetImmediate = vi.fn(setImmediate);
      const done = Promise.withResolvers<void>();
      const scope = createContext({
        setImmediate: hostSetImmediate,
        clearImmediate,
        setTimeout,
        clearTimeout,
        reportDone: done.resolve,
      });
      const globalsBefore = Object.keys(scope);

      runInContext(source, scope);
      await done.promise;

      expect(scope.setImmediate).toBe(hostSetImmediate);
      expect(hostSetImmediate).toHaveBeenCalled();
      const added = Object.keys(scope).filter(
        (key) => !globalsBefore.includes(key),
      );
      expect(added.filter((key) => DECLARED_NAME.test(key))).toEqual([]);
    },
  );

  it("keeps the deflated text in a function body until it is called", async () => {
    const module = await workerModule(true, "deflated");
    const thunk = runInContext(
      module.replace(/^export default /, "").replace(/;$/, ""),
      createContext({}),
    ) as () => string;
    expect(typeof thunk).toBe("function");
    expect(thunk()).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(inflateRawSync(Buffer.from(thunk(), "base64")).toString()).toBe(
      await workerSource(true),
    );
  });

  it("stops the build of a Web Worker root that requires a Node built-in", async () => {
    await expect(
      workerModule(false, "deflated", {
        fixture: "requires-node-worker.ts",
        runtime: RUNTIMES.webWorker,
      }),
    ).rejects.toThrow(
      'worker.js requires "node:path", which a Web Worker does not give',
    );
  });

  it("stops the build of a Web Worker root that imports a Node built-in at run time", async () => {
    await expect(
      workerModule(false, "deflated", {
        fixture: "imports-node-worker.ts",
        runtime: RUNTIMES.webWorker,
      }),
    ).rejects.toThrow(
      'worker.js imports "node:path", which a Web Worker does not give',
    );
  });

  it("stops the build of a Web Worker root that requires a computed name", async () => {
    await expect(
      workerModule(false, "deflated", {
        fixture: "computed-require-worker.ts",
        runtime: RUNTIMES.webWorker,
      }),
    ).rejects.toThrow(
      "worker.js refers to require, which a Web Worker does not give",
    );
  });

  it("stops the build of a root that bundles a package with no licence file", async () => {
    await expect(
      workerModule(false, "deflated", {
        fixture: "unlicensed-package-worker.ts",
        runtime: RUNTIMES.webWorker,
        notices: { fallbacks: await emptyManifest() },
      }),
    ).rejects.toThrow(
      /worker\.js bundles @sqlite\.org\/sqlite-wasm \S+, which ships no licence file/,
    );
  });
});
