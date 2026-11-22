import type {
  ParseFailed,
  ParseRequest,
  ParseReply,
  ParseWorkerDied,
} from "#core/citation-parse/client.ts";
import { Context, Effect, Layer } from "effect";

import { obsidianEvents } from "@zotlit/obsidian-kit/effect-obsidian-events.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";

import { makeRecoveringParseClient } from "#core/citation-parse/recovering-client.ts";
import { connectParseWorker } from "#core/citation-parse/worker-host.ts";

export class CitationParse extends Context.Service<
  CitationParse,
  {
    parse(
      request: ParseRequest,
    ): Effect.Effect<ParseReply, ParseWorkerDied | ParseFailed>;
  }
>()("zotlit/citation-parse/CitationParse") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    CitationParse: CitationParse;
  }
}

export const layerCitationParse = (workerSource: string) =>
  Layer.effect(
    CitationParse,
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      const client = yield* makeRecoveringParseClient(
        connectParseWorker(workerSource),
      );
      const events = yield* obsidianEvents<{ layoutReady: [] }>();
      yield* workspace.layoutReady.pipe(
        Effect.andThen(Effect.sync(() => events.callback("layoutReady")())),
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* events
        .consume(() => client.start)
        .pipe(Effect.forkScoped({ startImmediately: true }));
      return CitationParse.of({
        parse: Effect.fnUntraced(function* (request) {
          return yield* client.parse(request);
        }),
      });
    }),
  );
