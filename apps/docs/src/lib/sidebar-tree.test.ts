import { getDefaultSerovalPlugins } from "@tanstack/react-start";
import { Book } from "lucide-react";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isValidElement } from "react";
import * as v from "valibot";
import { expect, it } from "vitest";

import { renderSidebarTree, sidebarTreeData } from "./sidebar-tree.ts";
import { createDocsLoader, source } from "./source.ts";

import { docsSchema, metaSchema } from "#content-config";

const startRequire = createRequire(
  import.meta.resolve("@tanstack/react-start/package.json"),
);
const serverRequire = createRequire(
  startRequire.resolve("@tanstack/start-server-core/package.json"),
);
const { createRawStreamRPCPlugin } = await import(
  join(
    dirname(serverRequire.resolve("@tanstack/router-core/package.json")),
    "dist/esm/index.js",
  )
);
const { toCrossJSONStream, fromCrossJSON } = await import(
  serverRequire.resolve("seroval")
);
const { runWithStartContext } = await import(
  join(
    dirname(
      serverRequire.resolve("@tanstack/start-storage-context/package.json"),
    ),
    "dist/esm/index.js",
  )
);

function roundTrip<T>(tree: T): Promise<T> {
  return runWithStartContext(
    {
      request: new Request("https://zotlit.aidenlx.site"),
      startOptions: {},
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
      handlerType: "serverFn",
      getRouter: () => {
        throw new Error("The sidebar data should not need a router");
      },
    },
    () => {
      let serialized: unknown;
      const plugins = [
        createRawStreamRPCPlugin(() => {}),
        ...getDefaultSerovalPlugins(),
      ];
      toCrossJSONStream(
        { result: tree },
        {
          refs: new Map(),
          plugins,
          onParse: (value: unknown) => {
            serialized = value;
          },
          onError: (error: unknown) => {
            throw error;
          },
        },
      );
      return fromCrossJSON(serialized, { plugins }).result;
    },
  );
}

it("serializes a sidebar with plain page labels", async () => {
  const tree = sidebarTreeData(source.getPageTree("en"));
  await expect(roundTrip(tree)).resolves.toEqual(tree);
});

it("serializes sidebar icons on a page and a folder as names", async () => {
  const fixture = createDocsLoader({
    files: [
      {
        type: "meta",
        path: "guides/meta.json",
        data: v.parse(metaSchema, { title: "Guides", icon: "Book" }),
      },
      {
        type: "page",
        path: "guides/reading.mdx",
        data: v.parse(docsSchema, { title: "Reading", icon: "Book" }),
      },
    ],
  });
  const tree = await roundTrip(sidebarTreeData(fixture.getPageTree("en")));
  expect(tree).toMatchObject({
    children: expect.arrayContaining([
      expect.objectContaining({
        type: "folder",
        name: "Guides",
        icon: "Book",
        children: [
          expect.objectContaining({
            type: "page",
            name: "Reading",
            icon: "Book",
          }),
        ],
      }),
    ]),
  });

  const folder = renderSidebarTree(tree).children.find(
    (node) => node.type === "folder" && node.name === "Guides",
  );
  const page = folder?.type === "folder" ? folder.children[0] : undefined;
  for (const icon of [folder?.icon, page?.icon]) {
    expect(isValidElement(icon) && icon.type).toBe(Book);
  }
});

it.each([docsSchema, metaSchema])(
  "accepts a supported sidebar icon and rejects an unknown name",
  (schema) => {
    expect(v.is(schema, { title: "Reading", icon: "Book" })).toBe(true);
    expect(v.is(schema, { title: "Reading", icon: "Unknown" })).toBe(false);
  },
);
