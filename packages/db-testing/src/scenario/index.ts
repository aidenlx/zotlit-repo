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
  const pristine = readPristine();

  using resources = new DisposableStack();
  let path = ":memory:";
  if (options.storage === "temp-directory") {
    const directory = mkdtempSync(join(tmpdir(), "zotlit-scenario-"));
    resources.defer(() => rmSync(directory, { recursive: true, force: true }));
    path = join(directory, "zotero.sqlite");
    writeFileSync(path, pristine);
  }
  const sqlite = resources.use(new DatabaseSync(path));
  if (path === ":memory:") sqlite.deserialize(pristine);
  seedScenario(sqlite, options.annotations);
  const layout =
    options.layout ??
    (process.env.ZOTLIT_SCENARIO_LAYOUT as ScenarioLayout | undefined);
  if (layout === "lowest") toLowestLayout(sqlite);
  const db = connect(sqlite);
  const held = resources.move();
  const close = () => held.dispose();
  return {
    db,
    sqlite,
    path,
    close,
    [Symbol.dispose]: close,
  };
}

export function openPristineDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.deserialize(readPristine());
  return sqlite;
}

function readPristine(): Buffer {
  return (pristineBytes ??= gunzipSync(readFileSync(pristineTemplatePath())));
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
