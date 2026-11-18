import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describeDriverConformance } from "@zotlit/db-testing/conformance";
import type { ConformanceConnection } from "@zotlit/db-testing/conformance";

import { connectClient, createClient } from "./node.ts";

/** A new database file that `setup` built, and the cleanup of its directory. */
function databaseFile(setup: string): { path: string; remove: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "zotlit-conformance-"));
  const path = join(directory, "zotero.sqlite");
  const sqlite = new DatabaseSync(path);
  sqlite.exec(setup);
  sqlite.close();
  return {
    path,
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function connection(
  db: ReturnType<typeof connectClient>,
  release: () => void = () => {},
): ConformanceConnection {
  return {
    db,
    [Symbol.dispose]: () => {
      db.$client.close();
      release();
    },
  };
}

describeDriverConformance("node:sqlite", {
  open: (setup) => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(setup);
    return connection(connectClient(sqlite));
  },
  openReadOnly: (setup) => {
    const file = databaseFile(setup);
    return connection(
      createClient(file.path, { connection: { readOnly: true } }),
      file.remove,
    );
  },
  openShared: (setup) => {
    const file = databaseFile(setup);
    return [
      connection(createClient(file.path)),
      connection(createClient(file.path), file.remove),
    ];
  },
});
