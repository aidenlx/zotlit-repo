import { Effect } from "effect";

declare const reportDone: () => void;

void Effect.runPromise(Effect.yieldNow).then(() => reportDone());
