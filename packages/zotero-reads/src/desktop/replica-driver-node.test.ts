import type { ReplicaHandle } from "#worker/replica-driver.ts";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";

import { describeDriverConformance } from "@zotlit/db-testing/conformance";
import type { ConformanceConnection } from "@zotlit/db-testing/conformance";

import { nodeReplicaDriver } from "./replica-driver-node.ts";

import { describeReplicaStore } from "#__fixtures__/replica-store-suite.ts";

const root = mkdtempSync(join(tmpdir(), "zotlit-replica-node-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let folders = 0;
const nextFolder = () => join(root, `replica-${++folders}`);

function connection(handle: ReplicaHandle): ConformanceConnection {
  return { db: handle.db, [Symbol.dispose]: () => handle.close() };
}

describeDriverConformance("the node:sqlite replica driver", {
  open: (setup) => {
    const handle = nodeReplicaDriver(nextFolder()).open("conformance.sqlite");
    handle.exec(setup);
    return connection(handle);
  },
  openReadOnly: (setup) => {
    const handle = nodeReplicaDriver(nextFolder()).open("conformance.sqlite");
    handle.exec(setup);
    handle.exec("pragma query_only = on");
    return connection(handle);
  },
});

const storeFolder = nextFolder();

describeReplicaStore("the node:sqlite driver on a file", {
  driver: async () => nodeReplicaDriver(storeFolder),
  leaveSidecars: (_driver, file) => {
    for (const name of [`${file}-journal`, `${file}-wal`])
      writeFileSync(join(storeFolder, name), "leftover");
  },
  exists: (_driver, file) => existsSync(join(storeFolder, file)),
  checkpointStatements: 1,
});

const FILE = "zotero-replica.sqlite";
const JOURNAL_LIMIT = 4 * 1024 * 1024;

const bodies = (handle: ReplicaHandle) =>
  handle.db
    .all<{ body: string }>("select body from notes order by id")
    .map((row) => row.body);

function committedReplica(folder: string): void {
  const handle = nodeReplicaDriver(folder).open(FILE);
  handle.exec("create table notes (id integer primary key, body text)");
  handle.exec("insert into notes (body) values ('committed')");
  handle.close();
}

function openInTest(folder: string): ReplicaHandle {
  const handle = nodeReplicaDriver(folder).open(FILE);
  onTestFinished(() => handle.close());
  return handle;
}

function applyingWorker(folder: string): Promise<Worker> {
  const worker = new Worker(
    new URL("../__fixtures__/replica-apply-worker.ts", import.meta.url),
    { workerData: { folder, file: FILE } },
  );
  onTestFinished(async () => {
    await worker.terminate();
  });
  return new Promise((resolve, reject) => {
    worker.once("message", () => resolve(worker));
    worker.once("error", reject);
  });
}

describe("the node:sqlite replica driver", () => {
  it("holds the file for one connection from its open, before any write", () => {
    const folder = nextFolder();
    committedReplica(folder);
    const first = nodeReplicaDriver(folder).open(FILE);
    try {
      expect(() => nodeReplicaDriver(folder).open(FILE)).toThrow(
        /database is locked/,
      );
    } finally {
      first.close();
    }
    const next = openInTest(folder);
    expect(bodies(next)).toEqual(["committed"]);
  });

  it("lets the next Worker open the file with the old state complete after a Worker stops during an apply", async () => {
    const folder = nextFolder();
    committedReplica(folder);
    const worker = await applyingWorker(folder);
    expect(() => nodeReplicaDriver(folder).open(FILE)).toThrow(
      /database is locked/,
    );
    expect(await worker.terminate()).toBe(1);
    const next = openInTest(folder);
    expect(bodies(next)).toEqual(["committed"]);
  });

  it("empties the write-ahead log at a checkpoint after the commit of an apply", () => {
    const folder = nextFolder();
    committedReplica(folder);
    const handle = openInTest(folder);
    handle.exec("begin immediate");
    for (let row = 0; row < 10_000; row++)
      handle.db.run(`insert into notes (body) values ('${"x".repeat(1_000)}')`);
    expect(statSync(join(folder, `${FILE}-wal`)).size).toBeGreaterThan(
      JOURNAL_LIMIT,
    );
    handle.exec("commit");
    handle.checkpoint();
    expect(statSync(join(folder, `${FILE}-wal`)).size).toBe(0);
  });

  it("creates the folder of the replica", () => {
    const folder = join(nextFolder(), "zotlit", "vault-id");
    nodeReplicaDriver(folder).open(FILE).close();
    expect(existsSync(join(folder, FILE))).toBe(true);
  });
});
