import { mkdir, writeFile } from "node:fs/promises";

import { describeQueryVocabulary } from "@zotlit/item-query/schema";

const outDir = new URL("../generated/", import.meta.url);
await mkdir(outDir, { recursive: true });
await writeFile(
  new URL("query.schema.json", outDir),
  `${JSON.stringify(describeQueryVocabulary(), null, 2)}\n`,
);
