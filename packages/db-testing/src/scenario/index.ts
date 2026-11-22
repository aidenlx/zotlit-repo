import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";

import { seedScenario } from "./seed.ts";

export {
  BULK_FIFTH_TAG,
  BULK_LIBRARY,
  BULK_TAG,
  bulkItemKey,
  seedBulkLibrary,
  seedBulkAnnotations,
  seedBulkAttachments,
} from "./bulk.ts";
export {
  SCENARIO_ITEMS,
  SCENARIO_LIBRARIES,
  type ScenarioItem,
  type ScenarioItemName,
  type ScenarioLibraryName,
} from "./seed.ts";

export type ScenarioLayout = "highest" | "lowest";

export interface ScenarioDatabaseOptions {
  annotations?: boolean;
  storage?: "memory" | "temp-directory";
  layout?: ScenarioLayout;
}

export interface ScenarioDatabase<Client> extends Disposable {
  db: Client;
  sqlite: DatabaseSync;
  path: string;
  close(): void;
}

const COLUMNS_AFTER_USERDATA_125 = [
  ["items", "clientVersion"],
  ["itemDataValues", "valueNormalized"],
  ["itemAnnotations", "textNormalized"],
  ["itemAnnotations", "commentNormalized"],
  ["tags", "nameNormalized"],
  ["creators", "firstNameNormalized"],
  ["creators", "lastNameNormalized"],
  ["collections", "clientVersion"],
  ["savedSearches", "clientVersion"],
  ["libraries", "clientVersion"],
] as const;

const LOWEST_VERSIONS = { userdata: 125, compatibility: 7 } as const;

let pristineBytes: Buffer | undefined;

export function openScenarioDatabase<Client>(
  connect: (sqlite: DatabaseSync) => Client,
  options: ScenarioDatabaseOptions = {},
): ScenarioDatabase<Client> {
  const pristine = (pristineBytes ??= gunzipSync(
    readFileSync(pristineTemplatePath()),
  ));

  let sqlite: DatabaseSync;
  let path: string;
  let directory: string | null = null;
  if (options.storage === "temp-directory") {
    directory = mkdtempSync(join(tmpdir(), "zotlit-scenario-"));
    path = join(directory, "zotero.sqlite");
    writeFileSync(path, pristine);
    sqlite = new DatabaseSync(path);
  } else {
    path = ":memory:";
    sqlite = new DatabaseSync(path);
    sqlite.deserialize(pristine);
  }

  try {
    seedScenario(sqlite, options.annotations);
    const layout =
      options.layout ??
      (process.env.ZOTLIT_SCENARIO_LAYOUT as ScenarioLayout | undefined);
    if (layout === "lowest") toLowestLayout(sqlite);
  } catch (error) {
    sqlite.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  const close = () => {
    if (sqlite.isOpen) sqlite.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  };
  return {
    db: connect(sqlite),
    sqlite,
    path,
    close,
    [Symbol.dispose]: close,
  };
}

function toLowestLayout(sqlite: DatabaseSync): void {
  for (const [table, column] of COLUMNS_AFTER_USERDATA_125) {
    sqlite.exec(`alter table "${table}" drop column "${column}"`);
  }
  const stamp = sqlite.prepare(
    "update version set version = ? where schema = ?",
  );
  stamp.run(LOWEST_VERSIONS.userdata, "userdata");
  stamp.run(LOWEST_VERSIONS.compatibility, "compatibility");
}

function pristineTemplatePath(): string {
  const packageRoot = dirname(
    createRequire(import.meta.url).resolve("@zotlit/db-testing/package.json"),
  );
  return join(
    packageRoot,
    "..",
    "scripts",
    "lib",
    "fixture",
    "pristine-zotero.sqlite.gz",
  );
}
