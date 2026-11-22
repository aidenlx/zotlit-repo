import { Context, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { viewRuntime } from "./view-atoms.ts";

export class ShowInLibrary extends Context.Service<
  ShowInLibrary,
  {
    show(indexedKey: string): Effect.Effect<void>;
  }
>()("zotlit/library-view/ShowInLibrary") {}

declare module "./view-atoms.ts" {
  interface ViewServiceRegistry {
    ShowInLibrary: ShowInLibrary;
  }
}

export const showInLibraryCommand = Atom.keepAlive(
  viewRuntime.fn(
    (indexedKey: string) =>
      Effect.gen(function* () {
        yield* (yield* ShowInLibrary).show(indexedKey);
      }),
    { concurrent: true },
  ),
);
