import type { AnswerEnv, AnswerJob } from "#worker/item-query/answer.ts";
import { Effect } from "effect";

import { encodeCommand, queryFailed } from "#worker/item-query/answer.ts";
import { failure } from "#worker/item-query/contract.ts";

export const answerText = (job: AnswerJob, env: AnswerEnv) =>
  Effect.suspend(() => {
    let text = "";
    return encodeCommand(job, env, {
      head: () => Effect.void,
      emit: (piece) =>
        Effect.sync(() => {
          text += piece;
        }),
    }).pipe(
      queryFailed(job),
      Effect.map(() => text),
      Effect.catchTag("QueryFailed", ({ diagnostic }) =>
        Effect.succeed(failure(job.command, diagnostic)),
      ),
    );
  });
