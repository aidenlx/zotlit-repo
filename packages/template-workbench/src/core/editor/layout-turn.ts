import type { Effect } from "effect";
import { Semaphore } from "effect";

const layoutTurn = Semaphore.makeUnsafe(1);
export const inLayoutTurn = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  layoutTurn.withPermit(effect);
