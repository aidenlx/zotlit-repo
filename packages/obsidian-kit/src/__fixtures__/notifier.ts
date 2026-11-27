import { Effect, Layer, Queue } from "effect";
import { noticeFibers, Notifier } from "#notifier.ts";
import type { NoticeContent, NoticeMessage } from "#notice.ts";

export interface RecordedNotice {
  readonly messages: NoticeMessage[];
  readonly duration: number | undefined;
  hidden: boolean;
}

export function noticeContentOf(
  message: NoticeMessage | undefined,
): NoticeContent {
  if (message === undefined || typeof message === "string")
    throw new Error("Expected a notice with parts");
  return message;
}

function hidingOnPress(
  notice: RecordedNotice,
  message: NoticeMessage,
): NoticeMessage {
  if (typeof message === "string" || !message.actions) return message;
  return {
    ...message,
    actions: message.actions.map((action) => ({
      label: action.label,
      run: () => {
        notice.hidden = true;
        action.run();
      },
    })),
  };
}

export function testNotifier() {
  const notices: RecordedNotice[] = [];
  const record = (message: NoticeMessage, duration: number | undefined) => {
    const notice: RecordedNotice = { messages: [], duration, hidden: false };
    notice.messages.push(hidingOnPress(notice, message));
    notices.push(notice);
    return notice;
  };
  const base: Omit<Notifier["Service"], "track"> = {
    show: (message, options) =>
      Effect.sync(() => {
        const notice = record(message, options?.duration);
        return {
          hide: Effect.sync(() => {
            notice.hidden = true;
          }),
          setMessage: (next) =>
            Effect.sync(() => notice.messages.push(hidingOnPress(notice, next))),
        };
      }),
    progress: Effect.acquireRelease(
      Effect.sync(() => {
        let notice: RecordedNotice | null = null;
        return {
          hide: () => {
            if (notice) notice.hidden = true;
          },
          setMessage: (message: NoticeMessage) =>
            Effect.sync(() => {
              if (notice) notice.messages.push(hidingOnPress(notice, message));
              else notice = record(message, 0);
            }),
        };
      }),
      (progress) => Effect.sync(progress.hide),
    ).pipe(Effect.map(({ setMessage }) => ({ setMessage }))),
  };
  return {
    notices: notices as readonly RecordedNotice[],
    service: Notifier.of({
      ...base,
      track: () =>
        Effect.die(new Error("A tracked notice needs testNotifier().layer")),
    }),
    layer: Layer.effect(Notifier, noticeFibers(base)),
  };
}

export function layerSignalling(
  service: Notifier["Service"],
  shown: Queue.Queue<void>,
): Layer.Layer<Notifier> {
  return Layer.succeed(
    Notifier,
    Notifier.of({
      ...service,
      show: (message, options) =>
        service
          .show(message, options)
          .pipe(Effect.tap(Queue.offer(shown, undefined))),
    }),
  );
}
