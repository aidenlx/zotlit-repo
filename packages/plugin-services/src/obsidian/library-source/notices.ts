import { Effect, Fiber, FiberSet, Layer, Ref, Semaphore, Stream } from "effect";

import type { NoticeContent } from "@zotlit/obsidian-kit/notice.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeHandle } from "@zotlit/obsidian-kit/notifier.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { LibrarySource } from "./service.ts";
import type { LibrarySourceView, SyncPhase, SyncStop } from "./status.ts";
import {
  formatSyncTime,
  runningSyncOf,
  syncPhaseLines,
  syncPhaseOf,
} from "./status.ts";

export const SYNC_NOTICE_DELAY = "2 seconds";

export function syncNoticeOf(
  phase: SyncPhase,
  stop: (() => void) | null,
): NoticeContent {
  const bar =
    (phase.kind === "download" || phase.kind === "apply") &&
    phase.total !== null &&
    phase.total > 0
      ? { value: phase.done, max: phase.total }
      : null;
  const stopAction =
    stop !== null && phase.kind !== "apply" && phase.kind !== "waiting"
      ? { label: m.notice_online_stop_action(), run: stop }
      : null;
  return {
    title: m.notice_online_syncing(),
    lines: syncPhaseLines(phase, formatSyncTime),
    progress: bar ?? "indeterminate",
    ...(stopAction && { actions: [stopAction] }),
  };
}

interface SyncShown {
  readonly syncId: number;
  readonly phase: SyncPhase;
  readonly stop: SyncStop | null;
}

const shownOf = (view: LibrarySourceView): SyncShown | null => {
  const syncId = runningSyncOf(view.status);
  const phase =
    view.status.kind === "running" ? syncPhaseOf(view.status.sync) : null;
  return syncId === null || phase === null
    ? null
    : { syncId, phase, stop: view.stop ?? null };
};

const sameShown = (a: SyncShown | null, b: SyncShown | null) =>
  JSON.stringify(a) === JSON.stringify(b);

interface SyncNoticeState {
  readonly sync: SyncShown | null;
  readonly due: boolean;
  readonly notice: NoticeHandle | null;
  readonly timer: Fiber.Fiber<void> | null;
}

const IDLE: SyncNoticeState = {
  sync: null,
  due: false,
  notice: null,
  timer: null,
};

export const layerOnlineSyncNotice: Layer.Layer<
  never,
  never,
  LibrarySource | Notifier
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const source = yield* LibrarySource;
    if (source.active !== "web-api") return;
    const notifier = yield* Notifier;
    const fibers = yield* FiberSet.make();
    const runFork = yield* FiberSet.runtime(fibers)();
    const state = yield* Ref.make(IDLE);
    const lock = yield* Semaphore.make(1);
    const locked = <A>(step: Effect.Effect<A>) => lock.withPermits(1)(step);
    const patch = (next: Partial<SyncNoticeState>) =>
      Ref.update(state, (before) => ({ ...before, ...next }));

    const press = () => {
      runFork(source.stopSync);
    };

    const hide = Effect.gen(function* () {
      const { notice } = yield* Ref.get(state);
      if (notice) yield* notice.hide;
      yield* patch({ notice: null });
    });

    const render = Effect.gen(function* () {
      const { sync, due, notice } = yield* Ref.get(state);
      if (sync === null) return yield* hide;
      const stop = sync.stop?.state ?? null;
      const hidden = stop === "requested" || stop === "confirmed";
      if (hidden || !(due || stop === "refused")) return yield* hide;
      const content = syncNoticeOf(
        sync.phase,
        stop === "refused" ? null : press,
      );
      if (notice) return yield* notice.setMessage(content);
      yield* patch({ notice: yield* notifier.show(content, { duration: 0 }) });
    });

    const elapse = (syncId: number) =>
      Effect.andThen(
        Effect.sleep(SYNC_NOTICE_DELAY),
        locked(
          Effect.gen(function* () {
            const { sync } = yield* Ref.get(state);
            if (sync?.syncId !== syncId) return;
            yield* patch({ due: true, timer: null });
            yield* render;
          }),
        ),
      );

    const follow = (next: SyncShown | null) =>
      locked(
        Effect.gen(function* () {
          const before = yield* Ref.get(state);
          if (before.sync?.syncId !== next?.syncId) {
            if (before.timer) yield* Fiber.interrupt(before.timer);
            yield* hide;
            yield* patch({
              due: false,
              timer: next
                ? yield* FiberSet.run(fibers, elapse(next.syncId))
                : null,
            });
          }
          yield* patch({ sync: next });
          yield* render;
        }),
      );

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Ref.get(state), ({ notice }) =>
        notice ? notice.hide : Effect.void,
      ),
    );
    yield* FiberSet.run(
      fibers,
      source.viewChanges.pipe(
        Stream.map((view) => shownOf(view)),
        Stream.changesWith(sameShown),
        Stream.runForEach((next) => follow(next)),
      ),
    );
  }).pipe(Effect.withSpan("LibrarySource.syncNotice")),
);
