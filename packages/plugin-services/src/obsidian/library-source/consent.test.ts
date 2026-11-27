import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import {
  DeviceStorage,
  layerDeviceStorageFrom,
} from "@zotlit/obsidian-kit/obsidian-device-storage.ts";

import {
  CONSENTED_ACCOUNT_KEY,
  makeConsent,
  PENDING_REMOVAL_KEY,
} from "./consent.ts";

const A = 42;
const B = 99;

it.effect(
  "records the first account only once, and none during a removal",
  () =>
    Effect.gen(function* () {
      const device = new MemoryDeviceStorage();
      const consent = yield* Effect.map(DeviceStorage, (storage) =>
        makeConsent(storage),
      ).pipe(Effect.provide(layerDeviceStorageFrom(device)));
      yield* consent.grantFirst(A);
      yield* consent.grantFirst(B);
      expect(yield* consent.current).toBe(A);
      device.saveLocalStorage(CONSENTED_ACCOUNT_KEY, null);
      device.saveLocalStorage(PENDING_REMOVAL_KEY, true);
      yield* consent.grantFirst(B);
      expect(yield* consent.current).toBeNull();
    }),
);
