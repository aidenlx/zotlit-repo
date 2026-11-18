import { Effect } from "effect";
import type {
  ParseClient,
  ParseFailed,
  ParseReply,
  ParseRequest,
  ParseWorkerDied,
} from "#core/citation-parse/client.ts";

export const effectTestParseClient = (
  parse: (request: ParseRequest, signal: AbortSignal) => Promise<ParseReply>,
): Pick<ParseClient, "parse"> => ({
  parse: (request) => effectTestParse(parse)(request),
});

export const effectTestParse =
  (
    parse: (request: ParseRequest, signal: AbortSignal) => Promise<ParseReply>,
  ) =>
  (request: ParseRequest): Effect.Effect<
    ParseReply,
    ParseWorkerDied | ParseFailed
  > =>
    Effect.tryPromise({
      try: (signal) => parse(request, signal),
      catch: (error) => error as ParseWorkerDied | ParseFailed,
    });
