import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

import { nodeReplicaDriver } from "./replica-driver-node.ts";

import { describeReplicaCounts } from "#__fixtures__/replica-counts.ts";

const root = mkdtempSync(join(tmpdir(), "zotlit-replica-counts-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let folders = 0;

describeReplicaCounts("the node:sqlite driver on a file", {
  driver: async () => nodeReplicaDriver(join(root, `replica-${++folders}`)),
  baseline: new URL("./replica-counts.node.json", import.meta.url),
});
