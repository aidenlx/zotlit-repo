import { expect, it } from "@effect/vitest";
import { Effect, Layer, Queue, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import { describe } from "vitest";

import {
  layerSignalling,
  noticeContentOf,
  testNotifier,
} from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  WebSyncProgress,
  WebSyncStatus,
} from "@zotlit/zotero-reads/contract/web-worker-rpc.ts";

import { layerOnlineSyncNotice } from "./notices.ts";
import { LibrarySource } from "./service.ts";
import type { LibrarySourceView, SyncStop, SyncStopState } from "./status.ts";
import { viewOf } from "./status.ts";

const IDLE: WebSyncStatus = {
  state: "ready",
  syncing: false,
  syncId: null,
  waitingForReaders: false,
  problem: null,
  progress: null,
  zoteroLocale: "en-US",
  unconsentedUserID: null,
  libraries: [],
};

const setup = Effect.fn("setup")(function* () {
  let sync = IDLE;
  let stop: SyncStop | null = null;
  const viewNow = () =>
    viewOf({
      selected: "web-api",
      status: {
        kind: "running",
        sync,
        account: null,
        serverSchemaVersion: null,
      },
      replace: null,
      removal: false,
      stop,
    });
  const view = yield* SubscriptionRef.make<LibrarySourceView>(viewNow());
  const publish = Effect.suspend(() => SubscriptionRef.set(view, viewNow()));
  let stops = 0;
  const answers = yield* Queue.unbounded<SyncStopState>();
  const notifier = testNotifier();
  const shown = yield* Queue.unbounded<void>();
  yield* Layer.build(
    layerOnlineSyncNotice.pipe(
      Layer.provide(
        Layer.mock(LibrarySource)({
          active: "web-api",
          reads: null,
          view: SubscriptionRef.get(view),
          viewChanges: SubscriptionRef.changes(view),
          stopSync: Effect.gen(function* () {
            const syncId = sync.syncId;
            if (syncId === null) return;
            stops++;
            stop = { syncId, state: "requested" };
            yield* publish;
            const state = yield* Queue.take(answers);
            if (stop?.syncId === syncId) stop = { syncId, state };
            yield* publish;
          }),
        }),
      ),
      Layer.provide(layerSignalling(notifier.service, shown)),
    ),
  );
  const syncing = (progress: WebSyncProgress | null, syncId = 1) =>
    Effect.suspend(() => {
      sync = { ...IDLE, syncing: true, syncId, progress };
      return Effect.andThen(publish, TestClock.adjust("0 millis"));
    });
  const ended = Effect.suspend(() => {
    sync = IDLE;
    return Effect.andThen(publish, TestClock.adjust("0 millis"));
  });
  const answer = (state: SyncStopState) =>
    Effect.andThen(Queue.offer(answers, state), TestClock.adjust("0 millis"));
  return {
    notices: notifier.notices,
    syncing,
    ended,
    answer,
    stops: () => stops,
    shown: Queue.take(shown),
  };
});

const last = (notices: ReturnType<typeof testNotifier>["notices"]) =>
  noticeContentOf(notices[0]?.messages.at(-1));

describe("the notice of a long sync of the online library", () => {
  it.effect("shows no notice for a sync that ends within 2 seconds", () =>
    Effect.gen(function* () {
      const { notices, syncing, ended } = yield* setup();
      yield* syncing(null);
      yield* syncing({ phase: "download", done: 3, total: 3 });
      yield* TestClock.adjust("1900 millis");
      yield* ended;
      yield* TestClock.adjust("10 seconds");
      expect(notices).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "shows the download with Stop sync after 2 seconds, then the wait and the update with no button, and closes when the sync ends",
    () =>
      Effect.gen(function* () {
        const { notices, syncing, ended } = yield* setup();
        yield* syncing({ phase: "download", done: 10, total: 120 });
        yield* TestClock.adjust("2 seconds");
        expect(notices).toHaveLength(1);
        expect(notices[0]!.duration).toBe(0);
        expect(last(notices)).toMatchObject({
          title: m.notice_online_syncing(),
          lines: [
            m.settings_online_status_downloading({ done: "10", total: "120" }),
          ],
          progress: { value: 10, max: 120 },
          actions: [{ label: m.notice_online_stop_action() }],
        });

        yield* syncing({ phase: "download", done: 60, total: 120 });
        expect(last(notices)).toMatchObject({
          lines: [
            m.settings_online_status_downloading({ done: "60", total: "120" }),
          ],
          progress: { value: 60, max: 120 },
        });

        yield* syncing({ phase: "waiting" });
        expect(last(notices)).toEqual({
          title: m.notice_online_syncing(),
          lines: [m.settings_online_status_waiting()],
          progress: "indeterminate",
        });

        yield* syncing({ phase: "apply", done: 40, total: 120 });
        expect(last(notices)).toEqual({
          title: m.notice_online_syncing(),
          lines: [
            m.settings_online_status_applying({ done: "40", total: "120" }),
            m.settings_online_status_searches_wait(),
          ],
          progress: { value: 40, max: 120 },
        });
        expect(notices[0]!.hidden).toBe(false);

        yield* ended;
        expect(notices[0]!.hidden).toBe(true);
        expect(notices).toHaveLength(1);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "shows the count so far with a bar that moves on its own until every library has counted its items",
    () =>
      Effect.gen(function* () {
        const { notices, syncing } = yield* setup();
        yield* syncing({ phase: "download", done: 40, total: null });
        yield* TestClock.adjust("2 seconds");
        expect(last(notices)).toMatchObject({
          lines: [m.settings_online_status_downloaded({ done: "40" })],
          progress: "indeterminate",
          actions: [{ label: m.notice_online_stop_action() }],
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "offers Stop sync before the download counts, with a bar that moves on its own",
    () =>
      Effect.gen(function* () {
        const { notices, syncing } = yield* setup();
        yield* syncing(null);
        yield* TestClock.adjust("2 seconds");
        expect(last(notices)).toMatchObject({
          lines: [m.settings_online_status_syncing()],
          progress: "indeterminate",
          actions: [{ label: m.notice_online_stop_action() }],
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "closes the notice when the Worker confirms Stop sync, and shows the next long sync again",
    () =>
      Effect.gen(function* () {
        const { notices, syncing, ended, answer, stops } = yield* setup();
        yield* syncing({ phase: "download", done: 10, total: 120 });
        yield* TestClock.adjust("2 seconds");
        last(notices).actions![0]!.run();
        yield* TestClock.adjust("0 millis");
        expect(stops()).toBe(1);
        expect(notices[0]!.hidden).toBe(true);
        yield* answer("confirmed");
        const shown = notices[0]!.messages.length;
        yield* syncing({ phase: "download", done: 20, total: 120 });
        expect(notices[0]!.messages).toHaveLength(shown);
        expect(notices).toHaveLength(1);

        yield* ended;
        yield* syncing({ phase: "download", done: 0, total: 50 }, 2);
        yield* TestClock.adjust("2 seconds");
        expect(notices).toHaveLength(2);
        expect(notices[1]!.hidden).toBe(false);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "shows the notice again at once with no Stop sync when the Worker refused the stop, also before the update counts arrive",
    () =>
      Effect.gen(function* () {
        const { notices, syncing, ended, answer, shown } = yield* setup();
        yield* syncing({ phase: "download", done: 120, total: 120 });
        yield* TestClock.adjust("2 seconds");
        yield* shown;
        last(notices).actions![0]!.run();
        yield* answer("refused");
        yield* shown;
        expect(notices[0]!.hidden).toBe(true);
        expect(notices).toHaveLength(2);
        expect(noticeContentOf(notices[1]!.messages.at(-1))).toEqual({
          title: m.notice_online_syncing(),
          lines: [
            m.settings_online_status_downloading({ done: "120", total: "120" }),
          ],
          progress: { value: 120, max: 120 },
        });

        yield* syncing({ phase: "apply", done: 10, total: 120 });
        expect(noticeContentOf(notices[1]!.messages.at(-1))).toEqual({
          title: m.notice_online_syncing(),
          lines: [
            m.settings_online_status_applying({ done: "10", total: "120" }),
            m.settings_online_status_searches_wait(),
          ],
          progress: { value: 10, max: 120 },
        });
        yield* ended;
        expect(notices[1]!.hidden).toBe(true);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "keeps the Stop sync button and the wait of 2 seconds for a new sync when the answer for the old sync comes late",
    () =>
      Effect.gen(function* () {
        const { notices, syncing, ended, answer, shown } = yield* setup();
        yield* syncing({ phase: "download", done: 10, total: 120 });
        yield* TestClock.adjust("2 seconds");
        yield* shown;
        last(notices).actions![0]!.run();
        yield* TestClock.adjust("0 millis");
        yield* ended;
        yield* syncing({ phase: "download", done: 0, total: 50 }, 2);
        yield* answer("refused");
        expect(notices).toHaveLength(1);
        yield* TestClock.adjust("2 seconds");
        yield* shown;
        expect(notices).toHaveLength(2);
        expect(noticeContentOf(notices[1]!.messages.at(-1))).toMatchObject({
          actions: [{ label: m.notice_online_stop_action() }],
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "shows the next long sync after a stop whose sync ended before the answer",
    () =>
      Effect.gen(function* () {
        const { notices, syncing, ended, answer, shown } = yield* setup();
        yield* syncing({ phase: "download", done: 10, total: 120 });
        yield* TestClock.adjust("2 seconds");
        yield* shown;
        last(notices).actions![0]!.run();
        yield* TestClock.adjust("0 millis");
        yield* ended;
        yield* answer("refused");
        yield* syncing({ phase: "download", done: 0, total: 50 }, 2);
        yield* TestClock.adjust("2 seconds");
        yield* shown;
        expect(notices).toHaveLength(2);
        expect(notices[1]!.hidden).toBe(false);
      }).pipe(Effect.scoped),
  );
});
