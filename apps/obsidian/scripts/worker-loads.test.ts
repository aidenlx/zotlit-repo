import { parseSync } from "vite";
import { describe, expect, it } from "vitest";

import { RUNTIMES } from "@zotlit/scripts/runtime-table";
import type { Runtime } from "@zotlit/scripts/runtime-table";

import { checkLoads } from "./worker-loads.ts";

const loads = (
  code: string,
  scriptUrlGlobal?: string,
  runtime: Runtime = RUNTIMES.webWorker,
) =>
  checkLoads(parseSync("worker.js", code).program, {
    runtime,
    scriptUrlGlobal,
  });

const REFERS = "worker.js refers to require, which a Web Worker does not give";
const SCRIPTS =
  "worker.js calls importScripts with another URL than the global zotlitTemporalPiece";

describe("checkLoads", () => {
  it.each([
    ["import(resolveName(id))", "worker.js imports a computed name"],
    ['import("node:path")', 'worker.js imports "node:path"'],
    ['import("obsidian").then(String)', 'worker.js imports "obsidian"'],
    ['require("node:fs")', 'worker.js requires "node:fs"'],
    ['require?.("node:fs")', 'worker.js requires "node:fs"'],
    ["require(getName())", REFERS],
    ['globalThis.require("node:fs")', 'worker.js requires "node:fs"'],
    ["self.require(`${id}`)", REFERS],
    ['self["require"]', REFERS],
    ['var r = require; r("./locale/" + i);', REFERS],
    ["const { load = require } = options;", REFERS],
    ["export { require };", REFERS],
    ['var s; s = self; s.require("node:fs");', 'worker.js requires "node:fs"'],
    ["self.importScripts(location.href)", SCRIPTS],
    ['self.importScripts(self.zotlitTemporalPiece, "extra.js")', SCRIPTS],
    ["importScripts(config.zotlitTemporalPiece)", SCRIPTS],
    ["e.importScripts(e[`zotlitTemporalPiece`])", SCRIPTS],
    ["importScripts(...[self.zotlitTemporalPiece])", SCRIPTS],
    [
      "var s; s = self; s = config; importScripts(s.zotlitTemporalPiece)",
      SCRIPTS,
    ],
    ["const self = config; importScripts(self.zotlitTemporalPiece)", SCRIPTS],
  ])("stops %s", (code, failure) => {
    expect(loads(code, "zotlitTemporalPiece")).toEqual([
      expect.stringContaining(failure),
    ]);
  });

  it.each([
    'const hint = "Click import(name) to continue";',
    '/*! Use require("fs") in Node only. */ const hint = 1;',
    "const store = { import(e) { return e; }, require(e) { return e; } };",
    "class Database { import(bytes) { return bytes; } #require = 1; }",
    "const node = module.require; label: for (;;) break label;",
    'if (typeof require === "function") hint();',
    "function load(require) { return require(name); }",
    "{ const require = makeLoader(); require(name); }",
    "try { run(); } catch (require) { report(require); }",
    "self.importScripts(self.zotlitTemporalPiece)",
    "globalThis.importScripts(globalThis.zotlitTemporalPiece)",
    "importScripts(self[`zotlitTemporalPiece`])",
    "var Q9, $9; Q9 = {}, $9 = self, $9.importScripts($9.zotlitTemporalPiece);",
    "const g = globalThis; g.importScripts(g.zotlitTemporalPiece);",
  ])("lets %s build", (code) => {
    expect(loads(code, "zotlitTemporalPiece")).toEqual([]);
  });

  it("holds a runtime with modules to the require calls it can resolve", () => {
    expect(
      loads(
        'require("node:fs"); var r = require;',
        undefined,
        RUNTIMES.desktopWorker,
      ),
    ).toEqual([]);
    expect(
      loads("require(getName())", undefined, RUNTIMES.desktopWorker),
    ).toEqual([expect.stringContaining("worker.js requires a computed name")]);
  });

  it("stops importScripts in a root that names no piece global", () => {
    expect(loads("self.importScripts(self.zotlitTemporalPiece)")).toHaveLength(
      1,
    );
  });
});
