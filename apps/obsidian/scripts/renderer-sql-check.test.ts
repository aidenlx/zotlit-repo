import { resolve } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";

import { rendererSqlCheck } from "./renderer-sql-check.ts";

const packageRoot = resolve(import.meta.dirname, "..");

function bundle(fixture: string) {
  return build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve(
          import.meta.dirname,
          "__fixtures__/renderer-sql",
          fixture,
        ),
        formats: ["es"],
        fileName: () => "main.js",
      },
      rolldownOptions: { output: { codeSplitting: false } },
    },
    plugins: [rendererSqlCheck(packageRoot)],
  });
}

describe("rendererSqlCheck", () => {
  it("passes a renderer that reads Item fields from the database package root", async () => {
    await expect(bundle("item-fields.ts")).resolves.toBeDefined();
  });

  it("passes a renderer that plans and tests Item filters", async () => {
    await expect(bundle("item-filter.ts")).resolves.toBeDefined();
  });

  it("fails a renderer that reads an Item Seed through the Item Query package, with the import chain", async () => {
    await expect(bundle("item-seed-reader.ts")).rejects.toThrow(
      /main\.js bundles drizzle-orm[^]*__fixtures__\/renderer-sql\/item-seed-reader\.ts\n {2}-> \.\.\/\.\.\/packages\/item-query\/src\/index\.ts\n[^]*drizzle-orm\//,
    );
  });

  it("fails a renderer that reaches an Item Query reader, with the import chain", async () => {
    await expect(bundle("library-reader.ts")).rejects.toThrow(
      /main\.js bundles drizzle-orm[^]*__fixtures__\/renderer-sql\/library-reader\.ts\n {2}-> \.\.\/\.\.\/packages\/db\/src\/item-query\/index\.ts\n[^]*drizzle-orm\//,
    );
  });
});
