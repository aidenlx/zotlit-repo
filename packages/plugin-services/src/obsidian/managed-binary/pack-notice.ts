// The one notice of the Resource Pack: which plugin to install or update when
// a feature needs a Managed Binary that the pack does not give.
import { Effect } from "effect";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { PackBinaryStatus } from "./pack-binary.ts";
import { openPackStatusPage, packStatusSentence } from "./pack-row.ts";

/** The vault's record of the pack states whose notice it showed. */
export const PACK_NOTICE_KEY = "zotlit-resource-pack-notices";

/** The states of the pack itself; both Managed Binaries share each one. */
const PACK_STATES: ReadonlySet<PackBinaryStatus["kind"]> = new Set([
  "pack-absent",
  "pack-outdated",
  "plugin-outdated",
  "pack-damaged",
]);

const shownStates = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

/**
 * Tells the researcher which plugin to install or update, once per vault for
 * each state of the pack. A feature calls it with the status it met when it
 * needed a binary; a status that is no state of the pack shows nothing.
 */
export const packNotice = Effect.fn("ResourcePack.notice")(function* (
  status: PackBinaryStatus | null,
) {
  if (!status || !PACK_STATES.has(status.kind)) return;
  const storage = yield* DeviceStorage;
  const shown = shownStates(yield* storage.load(PACK_NOTICE_KEY));
  if (shown.includes(status.kind)) return;
  yield* storage.save(PACK_NOTICE_KEY, [...shown, status.kind]);
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
            openPackStatusPage(status);
          });
      });
    }),
    { duration: 0 },
  );
});
