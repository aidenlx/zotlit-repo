import { Semaphore } from "effect";
import type { Effect } from "effect";

const layoutTurn = Semaphore.makeUnsafe(1);
export const inLayoutTurn = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  layoutTurn.withPermit(effect);
