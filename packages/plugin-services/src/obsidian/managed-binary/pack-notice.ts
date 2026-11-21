// The one notice of the Resource Pack: which plugin to install or update when
// a feature needs a Managed Binary that the pack does not give.
import { Effect, Option, Schema } from "effect";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { PackBinaryStatus } from "./pack-binary.ts";
import {
  openPackStatusPage,
  packReaderId,
  packStatusSentence,
} from "./pack-row.ts";

import { PACK_NOTICE_KEY } from "#core/managed-binary/resource-pack.ts";

/** The states of the pack itself; both Managed Binaries share each one. */
const PACK_STATES: ReadonlySet<PackBinaryStatus["kind"]> = new Set([
  "pack-absent",
  "pack-outdated",
  "plugin-outdated",
  "pack-damaged",
]);

/** The stored record; a value of another shape counts as no record. */
const decodeShown = Schema.decodeUnknownOption(Schema.Array(Schema.String));

/**
 * Tells the researcher which plugin to install or update, once per vault for
 * each state of the pack. A feature calls it with the status it met when it
 * needed a binary; a status that is no state of the pack shows nothing. The
 * feature goes on without the notice: a failure to record or show it is
 * logged here.
 */
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
      BaseNotice.render((renderer) => {
        renderer
          .setTitle(m.notice_resource_pack())
          .addText(packStatusSentence(status));
        renderer.addAction((button) => {
          button
            .setButtonText(m.settings_resource_pack_open())
            .setCta()
            .onClick(() => {
              openPackStatusPage(status, readerId);
            });
        });
      }),
      { duration: 0 },
    );
  },
  recover(
    (cause) =>
      Effect.logWarning("Could not show the Resource Pack notice", cause),
    Effect.void,
  ),
);
