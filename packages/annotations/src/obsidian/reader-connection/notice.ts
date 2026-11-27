import { Effect } from "effect";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { ReaderStatus } from "./status.ts";
import { readerStatusCopy } from "./status.ts";

export const FALLBACK_NOTICE_KEY = "zotlit-reader-fallback-notices";

const shownStatuses = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

export const fallbackNotice = Effect.fn("ReaderConnection.fallbackNotice")(
  function* (status: Exclude<ReaderStatus, "connected">) {
    const storage = yield* DeviceStorage;
    const shown = shownStatuses(yield* storage.load(FALLBACK_NOTICE_KEY));
    if (shown.includes(status)) return;
    yield* storage.save(FALLBACK_NOTICE_KEY, [...shown, status]);
    const copy = readerStatusCopy(status);
    const action = copy.action;
    yield* (yield* Notifier).show(
      {
        title: m.notice_reader_fallback(),
        lines: [copy.text],
        ...(action
          ? {
              actions: [
                {
                  label: action.label,
                  run: () => {
                    window.open(action.url);
                  },
                },
              ],
            }
          : {}),
      },
      { duration: 0 },
    );
  },
);
