import { resolve } from "node:path";
import { build, parseSync, Visitor } from "vite";
import { describe, expect, it } from "vitest";

import { RUNTIMES } from "@zotlit/scripts/runtime-table";

import { SQLITE_ENGINE_PIN } from "./__fixtures__/pack-pins.ts";
import { pluginBuildBase } from "./build-base.ts";

const SERVICE = resolve(
  import.meta.dirname,
  "../src/services/zotero-reads/web-worker-client.ts",
);

describe("pluginBuildBase", () => {
  it("gives the online library Worker service the Resource Pack's pin of the SQLite engine", async () => {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      define: pluginBuildBase("production", RUNTIMES.desktopRenderer).define,
      build: {
        write: false,
        minify: false,
        lib: { entry: SERVICE, formats: ["es"], fileName: () => "main.js" },
        rolldownOptions: { external: (id) => id !== SERVICE },
      },
    });
    const [chunk] = (Array.isArray(result) ? result : [result]).flatMap(
      (output) =>
        "output" in output
          ? output.output.filter((item) => item.type === "chunk")
          : [],
    );
    const code = chunk!.code;
    const free: string[] = [];
    const strings: unknown[] = [];
    new Visitor({
      Identifier: (node) => {
        if (node.name.startsWith("__SQLITE")) free.push(node.name);
      },
      Literal: (node) => strings.push(node.value),
    }).visit(parseSync("main.js", code).program);
    expect(free).toEqual([]);
    expect(strings).toContain(SQLITE_ENGINE_PIN);
  });
});
