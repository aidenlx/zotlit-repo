import { Effect, Option, Schema } from "effect";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { PackBinaryStatus } from "@zotlit/resource-pack/status.ts";

import {
  openPackStatusPage,
  packReaderId,
  packStatusSentence,
} from "./pack-row.ts";

import { PACK_NOTICE_KEY } from "#core/managed-binary/resource-pack.ts";

const PACK_STATES: ReadonlySet<PackBinaryStatus["kind"]> = new Set([
  "pack-absent",
  "pack-outdated",
  "plugin-outdated",
  "pack-damaged",
]);

const decodeShown = Schema.decodeUnknownOption(Schema.Array(Schema.String));

export const packNotice = Effect.fn("ResourcePack.notice")(
  function* (status: PackBinaryStatus | null) {
    if (!status || !PACK_STATES.has(status.kind)) return;
    const storage = yield* DeviceStorage;
    const shown = Option.getOrElse(
      decodeShown(yield* storage.load(PACK_NOTICE_KEY)),
      (): readonly string[] => [],
    );
    if (shown.includes(status.kind)) return;
    yield* storage.save(PACK_NOTICE_KEY, [...shown, status.kind]);
    const readerId = yield* packReaderId;
    yield* (yield* Notifier).show(
      {
        title: m.notice_resource_pack(),
        lines: [packStatusSentence(status)],
        actions: [
          {
            label: m.settings_resource_pack_open(),
            run: () => {
              openPackStatusPage(status, readerId);
            },
          },
        ],
      },
      { duration: 0 },
    );
  },
  recover(
    (cause) =>
      Effect.logWarning("Could not show the Resource Pack notice", cause),
    Effect.void,
  ),
);
