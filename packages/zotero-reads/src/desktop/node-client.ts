import type { OpenClient } from "#worker/connection.ts";
// The desktop host's database handle: a `node:sqlite` client as the
// Connection opens and closes it.
import { Effect } from "effect";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";

/** An {@link OpenClient} that owns nothing beyond its SQLite handle. */
export function nodeClient(client: NodeDatabaseClient): OpenClient {
  return { client, close: Effect.sync(() => client.$client.close()) };
}

/** Close a client, also one that `validateClient` already closed. */
export function closeClient(client: NodeDatabaseClient): Effect.Effect<void> {
  return Effect.sync(() => client.$client.close()).pipe(
    Effect.catchDefect(() => Effect.void),
  );
}
