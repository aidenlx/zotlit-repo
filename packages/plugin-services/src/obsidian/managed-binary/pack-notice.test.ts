// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { afterEach, describe, vi } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import {
  ButtonComponent,
  controlsOf,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { layerDeviceStorageFrom } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { PackBinaryStatus } from "./pack-binary.ts";
import { packNotice } from "./pack-notice.ts";

import { PACK_NOTICE_KEY } from "#core/managed-binary/resource-pack.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** One session of a vault: the notices it shows for each status a feature met. */
const session = Effect.fnUntraced(function* (
  storage: MemoryDeviceStorage,
  statuses: readonly (PackBinaryStatus | null)[],
) {
  const notifier = testNotifier();
  yield* Effect.forEach(statuses, (status) => packNotice(status)).pipe(
    Effect.provide(
      Layer.merge(notifier.layer, layerDeviceStorageFrom(storage)),
    ),
  );
  return notifier.notices.map(
    ({ messages }) => messages[0] as DocumentFragment,
  );
}, Effect.scoped);

describe("the Resource Pack notice", () => {
  it.effect("shows once per vault for each state of the pack", () =>
    Effect.gen(function* () {
      const storage = new MemoryDeviceStorage();

      const first = yield* session(storage, [
        { kind: "pack-absent" },
        { kind: "pack-absent" },
        { kind: "pack-damaged" },
      ]);
      const later = yield* session(storage, [
        { kind: "pack-absent" },
        { kind: "pack-damaged" },
        { kind: "pack-outdated" },
        { kind: "plugin-outdated" },
        { kind: "plugin-outdated" },
      ]);

      expect(first.map((notice) => notice.textContent)).toEqual([
        m.notice_resource_pack() + m.settings_resource_pack_status_absent(),
        m.notice_resource_pack() + m.settings_resource_pack_status_damaged(),
      ]);
      expect(later.map((notice) => notice.textContent)).toEqual([
        m.notice_resource_pack() +
          m.settings_resource_pack_status_pack_outdated(),
        m.notice_resource_pack() +
          m.settings_resource_pack_status_plugin_outdated(),
      ]);
      expect(storage.loadLocalStorage(PACK_NOTICE_KEY)).toEqual([
        "pack-absent",
        "pack-damaged",
        "pack-outdated",
        "plugin-outdated",
      ]);
    }),
  );

  it.effect(
    "stays silent for a binary that is ready, unread, or did not start",
    () =>
      Effect.gen(function* () {
        const storage = new MemoryDeviceStorage();

        const notices = yield* session(storage, [
          null,
          { kind: "ready", version: "1.2.0" },
          { kind: "failed", detail: "Not a wasm module" },
        ]);

        expect(notices).toEqual([]);
        expect(storage.loadLocalStorage(PACK_NOTICE_KEY)).toBeNull();
      }),
  );

  it.effect.each([
    ["pack-absent", "obsidian://show-plugin?id=zotlit-resources"],
    ["pack-outdated", "obsidian://show-plugin?id=zotlit-resources"],
    ["pack-damaged", "obsidian://show-plugin?id=zotlit-resources"],
    ["plugin-outdated", "obsidian://show-plugin?id=zotlit"],
  ] as const)("opens the page of the plugin that mends %s", ([kind, page]) =>
    Effect.gen(function* () {
      const open = vi.spyOn(window, "open").mockReturnValue(null);

      const [notice] = yield* session(new MemoryDeviceStorage(), [{ kind }]);
      const action = Array.from(
        notice?.querySelectorAll<HTMLElement>("*") ?? [],
      )
        .flatMap(controlsOf)
        .find((control) => control instanceof ButtonComponent);

      expect(action?.text).toBe(m.settings_resource_pack_open());
      action?.click();
      expect(open.mock.calls).toEqual([[page]]);
    }),
  );
});
