import { Effect } from "effect";

import type { RequestUrl } from "@zotlit/obsidian-kit/http-client.ts";

export const SCHEMA_PROBE_PATH = "/itemTypes";

export const readServerSchemaVersion = (
  send: RequestUrl,
  baseUrl: string,
): Effect.Effect<number | null, unknown> =>
  Effect.map(
    Effect.tryPromise(() =>
      send({
        url: `${baseUrl}${SCHEMA_PROBE_PATH}`,
        method: "HEAD",
        throw: false,
      }),
    ),
    (response) => {
      if (response.status < 200 || response.status >= 300) return null;
      const header = Object.entries(response.headers).find(
        ([name]) => name.toLowerCase() === "zotero-schema-version",
      );
      const version = Number(header?.[1]);
      return Number.isInteger(version) ? version : null;
    },
  );
