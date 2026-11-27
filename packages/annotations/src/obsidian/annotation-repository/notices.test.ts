import { it } from "@effect/vitest";
import { Context, Deferred, Effect, Fiber, Layer } from "effect";
import { expect } from "vitest";

import {
  noticeContentOf,
  testNotifier,
} from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import type { RecordedNotice } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import type { NoticeAction } from "@zotlit/obsidian-kit/notice.ts";
// @vitest-environment happy-dom
import { testEvent } from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import type {
  LocalApiFailure,
  LocalApiResult,
} from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";

import type { EditingCapability } from "./capability.ts";
import { CapabilityNotices, layerCapabilityNotices } from "./notices.ts";
import { AnnotationRepository } from "./service.ts";
import type { MutationState, WriteConflict } from "./write.ts";
import { IDLE } from "./write.ts";

const ATTACHMENT = "ABCD2345";
const ANNOTATION = "EFGH2345";
const CLOSED: EditingCapability = {
  kind: "read-only",
  reason: "zotero-unavailable",
};
const CONFLICT: MutationState = {
  kind: "conflict",
  conflict: {} as WriteConflict,
};

function actionOf(notice: RecordedNotice): NoticeAction | null {
  return noticeContentOf(notice.messages[0]).actions?.[0] ?? null;
}

function drawn(notice: RecordedNotice) {
  return {
    title: noticeContentOf(notice.messages[0]).title,
    action: actionOf(notice)?.label ?? null,
    duration: notice.duration,
  };
}

function press(notice: RecordedNotice): void {
  actionOf(notice)!.run();
}

function seam(
  options: {
    authorize?: Effect.Effect<LocalApiResult<void>>;
    probe?: Effect.Effect<void>;
    cardShown?: boolean;
  } = {},
) {
  return Effect.gen(function* () {
    const ran: string[] = [];
    let capability: EditingCapability = CLOSED;
    let mutation: MutationState = IDLE;
    const events = {
      capabilityChanges: testEvent<void>(),
      annotationChanged: testEvent<string>(),
      writeConflicts: testEvent<{
        annotationKey: string;
        attachmentKey: string;
      }>(),
      writeRefusals: testEvent<{ failure: LocalApiFailure; library: string }>(),
      serverChanges: testEvent<string>(),
      writeRefusalsRetired: testEvent<void>(),
    };
    const notifier = testNotifier();
    const context = yield* Layer.build(
      layerCapabilityNotices({
        openEditingSettings: () => ran.push("open"),
        cardShown: () => options.cardShown ?? false,
        revealAnnotation: (annotationKey) =>
          ran.push(`reveal ${annotationKey}`),
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            notifier.layer,
            Layer.mock(AnnotationRepository, {
              capabilityFor: () => Effect.sync(() => capability),
              mutationFor: () => Effect.sync(() => mutation),
              probe: options.probe ?? Effect.void,
              capabilityChanges: events.capabilityChanges.stream,
              annotationChanged: events.annotationChanged.stream,
              writeConflicts: events.writeConflicts.stream,
            }),
            Layer.mock(ZoteroLocalApi, {
              authorize:
                options.authorize ?? Effect.succeed({ value: undefined }),
              writeRefusals: events.writeRefusals.stream,
              serverChanges: events.serverChanges.stream,
              writeRefusalsRetired: events.writeRefusalsRetired.stream,
            }),
          ),
        ),
      ),
    );
    return {
      notices: Context.get(context, CapabilityNotices),
      notifier,
      ran,
      events,
      shown: () => notifier.notices.map(drawn),
      titles: () => notifier.notices.map((notice) => drawn(notice).title),
      setCapability: (next: EditingCapability) => {
        capability = next;
      },
      setMutation: (next: MutationState) => {
        mutation = next;
      },
    };
  });
}

it.effect("re-checks Zotero before it opens the editing settings row", () =>
  Effect.gen(function* () {
    const ran: string[] = [];
    const answer = yield* Deferred.make<void>();
    const { notices, ran: opened } = yield* seam({
      probe: Effect.sync(() => ran.push("probe")).pipe(
        Effect.andThen(Deferred.await(answer)),
      ),
    });

    const gesture = yield* Effect.forkChild(notices.showEditingCapability, {
      startImmediately: true,
    });
    expect(ran).toEqual(["probe"]);
    expect(opened).toEqual([]);

    yield* Deferred.succeed(answer, undefined);
    yield* Fiber.join(gesture);
    expect(opened).toEqual(["open"]);
  }).pipe(Effect.scoped),
);

function answering(...answers: LocalApiResult<void>[]) {
  const asked = { count: 0 };
  return Effect.map(
    seam({
      authorize: Effect.sync(() => {
        asked.count += 1;
        return answers.shift() ?? { value: undefined };
      }),
    }),
    (built) => ({ ...built, asked }),
  );
}

it.effect("says editing is on after Always Allow", () =>
  Effect.gen(function* () {
    const { notices, shown } = yield* answering({ value: undefined });

    yield* notices.allowEditing;

    expect(shown()).toEqual([
      {
        title: m.notice_zotero_editing_enabled(),
        action: null,
        duration: 3000,
      },
    ]);
  }).pipe(Effect.scoped),
);

it.effect(
  "says to choose Always Allow after Allow, and asks again only from its button",
  () =>
    Effect.gen(function* () {
      const { notices, notifier, shown, asked } = yield* answering(
        { failure: { kind: "not-remembered" } },
        { value: undefined },
      );

      yield* notices.allowEditing;
      expect(shown()).toEqual([
        {
          title: m.notice_zotero_editing_not_remembered(),
          action: m.capability_enable_editing(),
          duration: 10000,
        },
      ]);
      expect(asked.count).toBe(1);

      press(notifier.notices[0]!);
      expect(notifier.notices).toHaveLength(2);
      expect(notifier.notices[0]!.hidden).toBe(true);
      expect(asked.count).toBe(2);
      expect(shown()[1]!.title).toBe(m.notice_zotero_editing_enabled());
    }).pipe(Effect.scoped),
);

it.effect(
  "says the permission was not saved when this device cannot keep it",
  () =>
    Effect.gen(function* () {
      const { notices, titles } = yield* answering({
        failure: { kind: "not-saved" },
      });

      yield* notices.allowEditing;

      expect(titles()).toEqual([m.notice_zotero_editing_not_saved()]);
    }).pipe(Effect.scoped),
);

it.effect.each(["denied", "not-confirmed"] as const)(
  "stays silent after %s, which the capability status reports",
  (kind) =>
    Effect.gen(function* () {
      const { notices, shown } = yield* answering({
        failure: { kind },
      });

      yield* notices.allowEditing;

      expect(shown()).toEqual([]);
    }).pipe(Effect.scoped),
);

it.effect(
  "says why a gesture is blocked once per episode, and opens the settings row from its button",
  () =>
    Effect.gen(function* () {
      const built = yield* seam();
      const { notices, notifier } = built;

      yield* notices.reportBlockedGesture(ATTACHMENT);
      yield* notices.reportBlockedGesture(ATTACHMENT);
      expect(built.shown().map(({ action }) => action)).toEqual([
        m.notice_capability_open_settings(),
      ]);

      press(notifier.notices[0]!);
      expect(built.ran).toEqual(["open"]);

      built.setCapability({ kind: "writable" });
      built.events.capabilityChanges.emit();
      built.setCapability(CLOSED);
      yield* notices.reportBlockedGesture(ATTACHMENT);
      expect(notifier.notices).toHaveLength(2);
    }).pipe(Effect.scoped),
);

it.effect(
  "says a write conflict once while it stands on a card no view shows, and reveals the card",
  () =>
    Effect.gen(function* () {
      const built = yield* seam();
      const conflict = { annotationKey: ANNOTATION, attachmentKey: ATTACHMENT };

      built.events.writeConflicts.emit(conflict);
      built.setMutation(CONFLICT);
      built.events.annotationChanged.emit(ANNOTATION);
      built.events.writeConflicts.emit(conflict);
      expect(built.titles()).toEqual([m.notice_write_conflict()]);

      press(built.notifier.notices[0]!);
      expect(built.ran).toEqual([`reveal ${ANNOTATION}`]);

      built.setMutation(IDLE);
      built.events.annotationChanged.emit(ANNOTATION);
      built.events.writeConflicts.emit(conflict);
      expect(built.titles()).toEqual([
        m.notice_write_conflict(),
        m.notice_write_conflict(),
      ]);
    }).pipe(Effect.scoped),
);

it.effect("leaves a write conflict to the view that shows its card", () =>
  Effect.gen(function* () {
    const built = yield* seam({ cardShown: true });

    built.events.writeConflicts.emit({
      annotationKey: ANNOTATION,
      attachmentKey: ATTACHMENT,
    });

    expect(built.shown()).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect(
  "says a read-only library once until a probe retires the refusals",
  () =>
    Effect.gen(function* () {
      const built = yield* seam();
      const refusal = {
        failure: { kind: "library-read-only" } as const,
        library: "users/0",
      };

      built.events.writeRefusals.emit(refusal);
      built.events.writeRefusals.emit(refusal);
      expect(built.titles()).toEqual([m.notice_write_not_saved()]);
      press(built.notifier.notices[0]!);
      expect(built.ran).toEqual(["open"]);

      built.events.writeRefusalsRetired.emit();
      built.events.writeRefusals.emit(refusal);
      expect(built.notifier.notices).toHaveLength(2);
    }).pipe(Effect.scoped),
);

it.effect("says a changed Zotero database once per database", () =>
  Effect.gen(function* () {
    const built = yield* seam();

    built.events.serverChanges.emit("server-a");
    built.events.serverChanges.emit("server-a");
    built.events.serverChanges.emit("server-b");

    expect(built.titles()).toEqual([
      m.notice_write_not_saved(),
      m.notice_write_not_saved(),
    ]);
  }).pipe(Effect.scoped),
);

it.effect("stops listening when its Scope closes", () =>
  Effect.gen(function* () {
    const built = yield* Effect.scoped(seam());

    expect(built.events.serverChanges.subscribers).toBe(0);
    expect(built.events.writeConflicts.subscribers).toBe(0);
  }),
);
