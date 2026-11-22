import type { OpenClient } from "#worker/connection.ts";
import { Effect } from "effect";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";

export function nodeClient(client: NodeDatabaseClient): OpenClient {
  return { client, close: Effect.sync(() => client.$client.close()) };
}

export function closeClient(client: NodeDatabaseClient): Effect.Effect<void> {
  return Effect.sync(() => client.$client.close()).pipe(
    Effect.catchDefect(() => Effect.void),
  );
}
