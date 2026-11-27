import { Effect, Queue, Stream } from "effect";

export interface FocusWindow {
  readonly document: { hasFocus(): boolean };
  addEventListener(type: "focus" | "blur", listener: () => void): void;
  removeEventListener(type: "focus" | "blur", listener: () => void): void;
}

export interface WindowChange {
  readonly _tag: string;
  readonly window?: FocusWindow;
}

export const windowFocus = (
  changes: Stream.Stream<WindowChange>,
  open: Effect.Effect<Iterable<FocusWindow>>,
  main: FocusWindow = window,
): Stream.Stream<boolean> =>
  Stream.callback<boolean>(
    (queue) =>
      Effect.gen(function* () {
        const windows = new Set<FocusWindow>([main]);
        const check = () =>
          Queue.offerUnsafe(
            queue,
            [...windows].some((win) => win.document.hasFocus()),
          );
        const watch = (win: FocusWindow) => {
          win.addEventListener("focus", check);
          win.addEventListener("blur", check);
        };
        const unwatch = (win: FocusWindow) => {
          win.removeEventListener("focus", check);
          win.removeEventListener("blur", check);
        };
        for (const win of yield* open) windows.add(win);
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            for (const win of windows) watch(win);
          }),
          () =>
            Effect.sync(() => {
              for (const win of windows) unwatch(win);
            }),
        );
        yield* Stream.runForEach(changes, (change) =>
          Effect.sync(() => {
            const changed = change.window;
            if (!changed) return;
            if (change._tag === "window-open") {
              windows.add(changed);
              watch(changed);
            } else if (change._tag === "window-close") {
              windows.delete(changed);
              unwatch(changed);
            } else return;
            check();
          }),
        ).pipe(Effect.forkScoped({ startImmediately: true }));
        check();
      }),
    { bufferSize: 1, strategy: "sliding" },
  ).pipe(Stream.changes);
