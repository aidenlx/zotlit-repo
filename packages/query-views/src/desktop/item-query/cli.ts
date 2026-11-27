import type { QueryCliCommand } from "#worker/item-query/contract.ts";
import { Effect, Layer } from "effect";
import type { CliData } from "obsidian";

import type {
  CliCommandHandler,
  CliHost,
} from "@zotlit/obsidian-kit/cli-command.ts";
import { catchRejection } from "@zotlit/obsidian-kit/cli-params.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";

import { queryValuesFlags, queryFlags, queryCancelFlags } from "./contract.ts";
import { decodeCancelArguments, decodeGuideArguments } from "./decode.ts";
import { GUIDE_TOPIC_NAMES, renderGuide } from "./guide.ts";
import { QueryService } from "./service.ts";
import type { ItemQueryError, QueryCancelled } from "./service.ts";

import {
  envelope,
  failure,
  QUERY_COMMAND,
  QUERY_SCHEMA_COMMAND,
  QUERY_VALUES_COMMAND,
  QUERY_GUIDE_COMMAND,
  QUERY_CANCEL_COMMAND,
  rejectionDiagnostic,
} from "#worker/item-query/contract.ts";

export type QueryRuns = Pick<
  QueryService["Service"],
  "query" | "values" | "schema" | "cancel"
>;

export const layerQueryCli: Layer.Layer<
  never,
  never,
  PluginHost | QueryService
> = Layer.effectDiscard(
  Effect.gen(function* () {
    registerQueryCli(yield* PluginHost, yield* QueryService);
  }),
);

export function registerQueryCli(host: CliHost, runs: QueryRuns): void {
  host.registerCliCommand(QUERY_COMMAND, {
    description:
      "Query Zotero items and annotations as JSON; read zotlit:query-guide for syntax and zotlit:query-schema for the field catalog",
    flags: queryFlags,
    handler: runHandler("QueryCli.query", (params) => runs.query(params)),
  });
  host.registerCliCommand(QUERY_SCHEMA_COMMAND, {
    description:
      "Get the version-pinned schema download, source custom fields, and CLI defaults as JSON",
    flags: { from: queryFlags.from },
    handler: runHandler("QueryCli.schema", (params) => runs.schema(params)),
  });
  host.registerCliCommand(QUERY_VALUES_COMMAND, {
    description:
      "List exact Collection paths or Tag names per Library before writing a filter",
    flags: queryValuesFlags,
    handler: runHandler("QueryCli.values", (params) => runs.values(params)),
  });
  host.registerCliCommand(QUERY_GUIDE_COMMAND, {
    description:
      "Print the guide for zotlit:query, zotlit:query-values, zotlit:query-schema, and zotlit:query-cancel",
    flags: {
      topic: {
        value: `<${GUIDE_TOPIC_NAMES.join("|")}>`,
        description: "Guide topic; omit it for the whole guide",
      },
    },
    handler: guideHandler,
  });
  host.registerCliCommand(QUERY_CANCEL_COMMAND, {
    description:
      "Stop a running query started with id, and return as JSON whether one was running",
    flags: queryCancelFlags,
    handler: createQueryCancelHandler((id) => runs.cancel(id)),
  });
}

function runHandler(
  name: string,
  run: (
    params: CliData,
  ) => Effect.Effect<string, QueryCancelled | ItemQueryError>,
): CliCommandHandler {
  return Effect.fn(name)((params: CliData) => run(params));
}

const answerRejection = (command: QueryCliCommand) =>
  catchRejection((rejected) => failure(command, rejectionDiagnostic(rejected)));

export const guideHandler: CliCommandHandler = (params) =>
  decodeGuideArguments(params).pipe(
    Effect.map((topic) => renderGuide(topic)),
    answerRejection(QUERY_GUIDE_COMMAND),
  );

export function createQueryCancelHandler(
  cancel: (id: string) => Effect.Effect<boolean>,
): CliCommandHandler {
  return Effect.fn("QueryCli.cancel")(function* (params: CliData) {
    const id = yield* decodeCancelArguments(params);
    return envelope(QUERY_CANCEL_COMMAND, {
      ok: true,
      id,
      cancelRequested: yield* cancel(id),
    });
  }, answerRejection(QUERY_CANCEL_COMMAND));
}
