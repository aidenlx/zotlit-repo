import type { ReapWorkerSnapshots } from "#client/worker-host.ts";
import { Effect } from "effect";
import { tmpdir } from "node:os";

import { sweepTempDirectory } from "@zotlit/obsidian-desktop/temp-sweep.ts";
import type { ReapTempsOptions } from "@zotlit/obsidian-desktop/temp-sweep.ts";
import { ZOTERO_DB_READ_TEMP_PREFIX } from "@zotlit/plugin-kernel/constants.ts";
import { isErrno } from "@zotlit/plugin-kernel/errno.ts";

import { readParentBeside } from "./read-parent.ts";

export const reapReadClones = Effect.fnUntraced(function* ({
  parent = tmpdir(),
}: ReapTempsOptions = {}) {
  yield* sweepTempDirectory({
    directory: parent,
    kind: "database read clone",
    isResidue: (name) => {
      const pid = parseTempPid(name);
      return pid === null || pid === process.pid
        ? Effect.succeed(false)
        : Effect.map(isPidLive(pid), (live) => !live);
    },
  });
});

export const reapWorkerClones = Effect.fnUntraced(function* ({
  owner,
  parents,
}: {
  owner: string;
  parents: readonly string[];
}) {
  yield* Effect.forEach(
    parents,
    (directory) =>
      sweepTempDirectory({
        directory,
        kind: "database read clone",
        isResidue: (name) => Effect.succeed(parseTempOwner(name) === owner),
      }),
    { concurrency: "unbounded" },
  );
});

export const reapWorkerSnapshots: ReapWorkerSnapshots = ({
  owner,
  databasePaths,
}) =>
  reapWorkerClones({
    owner,
    parents: [tmpdir(), ...databasePaths.map(readParentBeside)],
  });

function parseTempOwner(entry: string): string | null {
  if (parseTempPid(entry) === null) return null;
  const rest = entry.slice(ZOTERO_DB_READ_TEMP_PREFIX.length);
  const tagged = rest.slice(rest.indexOf("-") + 1);
  const end = tagged.indexOf("-");
  return end > 0 ? tagged.slice(0, end) : null;
}

function parseTempPid(entry: string): number | null {
  if (!entry.startsWith(ZOTERO_DB_READ_TEMP_PREFIX)) return null;
  const rest = entry.slice(ZOTERO_DB_READ_TEMP_PREFIX.length);
  const end = rest.indexOf("-");
  if (end <= 0) return null;
  const pid = Number(rest.slice(0, end));
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function isPidLive(pid: number): Effect.Effect<boolean> {
  return Effect.try({
    try: () => process.kill(pid, 0),
    catch: (error) => isErrno(error, "EPERM"),
  }).pipe(
    Effect.as(true),
    Effect.catch((ownedByAnotherUser) => Effect.succeed(ownedByAnotherUser)),
  );
}
