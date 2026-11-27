import { parentPort, workerData } from "node:worker_threads";

import { nodeReplicaDriver } from "#desktop/replica-driver-node.ts";

const { folder, file } = workerData as { folder: string; file: string };
const handle = nodeReplicaDriver(folder).open(file);
handle.exec("begin immediate");
handle.db.run("insert into notes (body) values ('unfinished')");
parentPort?.on("message", () => undefined);
parentPort?.postMessage("applying");
