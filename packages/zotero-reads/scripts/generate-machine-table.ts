import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { renderTable } from "#worker/web-api-machine-table.ts";

const tablePath = join(
  resolve(import.meta.dirname, ".."),
  "src/worker/web-api-machine.table.md",
);

await writeFile(
  tablePath,
  `# Transitions of the Web API source\n\nGenerated from \`web-api-machine-table.ts\` by \`pnpm exec turbo run @zotlit/zotero-reads#generate:machine-table\`. Each cell is the next state of \`transition(state, event)\` and its commands.\n\n${renderTable()}\n`,
);
