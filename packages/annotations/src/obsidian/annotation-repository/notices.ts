import { Clock, Context, Duration, Effect, FiberSet, Layer } from "effect";

import type { NoticeContent } from "@zotlit/obsidian-kit/notice.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { dateTimeClock } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";

import type { CapabilityNotice } from "./capability-notices.ts";
import {
  allowEditingNotice,
  CapabilityNoticeLedger,
} from "./capability-notices.ts";
import { AnnotationRepository } from "./service.ts";

const NOTICE_DURATION = Duration.seconds(10);

export function capabilityNoticeMessage(
  { title, lines, action }: CapabilityNotice,
  runAction: () => void,
): NoticeContent {
  return {
    title,
    lines,
    ...(action === null
      ? {}
      : { actions: [{ label: action, run: runAction }] }),
  };
}

export function noticeDuration({
  sticky,
  durationMs,
}: CapabilityNotice): number {
  if (sticky) return 0;
  return durationMs ?? Duration.toMillis(NOTICE_DURATION);
}

export class CapabilityNotices extends Context.Service<
  CapabilityNotices,
  {
    readonly allowEditing: Effect.Effect<void>;
    readonly showEditingCapability: Effect.Effect<void>;
    reportBlockedGesture(attachmentKey: string): Effect.Effect<void>;
  }
>()("zotlit/annotation-repository/CapabilityNotices") {}

export interface CapabilityNoticePorts {
  readonly openEditingSettings: () => void;
  readonly cardShown: (annotationKey: string) => boolean;
  readonly revealAnnotation: (annotationKey: string) => void;
}

export function layerCapabilityNotices(
  ports: CapabilityNoticePorts,
): Layer.Layer<
  CapabilityNotices,
  never,
  AnnotationRepository | ZoteroLocalApi | Notifier
> {
  return Layer.effect(
    CapabilityNotices,
    Effect.gen(function* () {
      const repository = yield* AnnotationRepository;
      const api = yield* ZoteroLocalApi;
      const notifier = yield* Notifier;
      const clock = yield* Clock.Clock;
      const ledger = new CapabilityNoticeLedger(dateTimeClock(clock));
      const run = yield* FiberSet.makeRuntime<never>();

      const show = Effect.fnUntraced(function* (
        notice: CapabilityNotice,
        action: Effect.Effect<void>,
      ) {
        yield* notifier.show(
          capabilityNoticeMessage(notice, () => {
            run(action);
          }),
          { duration: noticeDuration(notice) },
        );
      });
      const openEditingSettings = Effect.sync(() =>
        ports.openEditingSettings(),
      );
      const showProblem = (notice: CapabilityNotice | null) =>
        notice ? show(notice, openEditingSettings) : Effect.void;

      const allowEditing: Effect.Effect<void> = Effect.gen(function* () {
        const notice = allowEditingNotice(yield* api.authorize);
        if (notice) yield* show(notice, allowEditing);
      }).pipe(Effect.withSpan("CapabilityNotices.allowEditing"));

      yield* forkEach(repository.capabilityChanges, () =>
        Effect.gen(function* () {
          const entries = yield* Effect.forEach(
            ledger.openEpisodes(),
            (attachmentKey) =>
              Effect.map(
                repository.capabilityFor(attachmentKey),
                (capability) => [attachmentKey, capability] as const,
              ),
          );
          ledger.refresh(new Map(entries));
        }),
      );
      yield* forkEach(repository.writeConflicts, ({ annotationKey }) =>
        Effect.gen(function* () {
          if (ports.cardShown(annotationKey)) return;
          const notice = ledger.conflictOffScreen(annotationKey);
          if (!notice) return;
          yield* Effect.logDebug(
            "A write conflict stands on a card no view shows",
          ).pipe(Effect.annotateLogs({ annotationKey }));
          yield* show(
            notice,
            Effect.sync(() => ports.revealAnnotation(annotationKey)),
          );
        }),
      );
      yield* forkEach(repository.annotationChanged, (annotationKey) =>
        Effect.gen(function* () {
          const mutation = yield* repository.mutationFor(annotationKey);
          if (mutation.kind !== "conflict")
            ledger.conflictResolved(annotationKey);
        }),
      );
      yield* forkEach(api.writeRefusals, ({ failure, library }) =>
        showProblem(ledger.writeRefused(failure, library)),
      );
      yield* forkEach(api.serverChanges, (serverID) =>
        showProblem(ledger.serverChanged(serverID)),
      );
      yield* forkEach(api.writeRefusalsRetired, () => {
        ledger.writeRefusalsRetired();
      });

      return CapabilityNotices.of({
        allowEditing,
        showEditingCapability: Effect.andThen(
          repository.probe,
          openEditingSettings,
        ).pipe(Effect.withSpan("CapabilityNotices.showEditingCapability")),
        reportBlockedGesture: Effect.fn(
          "CapabilityNotices.reportBlockedGesture",
        )(function* (attachmentKey) {
          const capability = yield* repository.capabilityFor(attachmentKey);
          const notice = ledger.blockedGesture(attachmentKey, capability);
          if (!notice) return;
          yield* Effect.logDebug("An edit gesture met a block").pipe(
            Effect.annotateLogs({ attachmentKey, capability }),
            withLogCategory("annotation-repository"),
          );
          yield* show(notice, openEditingSettings);
        }),
      });
    }).pipe(withLogCategory("annotation-repository")),
  );
}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    CapabilityNotices: CapabilityNotices;
  }
}
