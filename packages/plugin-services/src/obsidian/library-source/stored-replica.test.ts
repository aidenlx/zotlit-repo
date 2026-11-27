import { expect, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { describe, vi } from "vitest";

import * as m from "@zotlit/plugin-messages/messages.ts";

import type { OriginTree } from "./__fixtures__.ts";
import { originPools } from "./__fixtures__.ts";
import {
  listOtherPools,
  removeOriginDirectory,
  removeOtherPool,
} from "./stored-replica.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso).epochMilliseconds;

const THIS_VAULT = "1a2b3c4d5e6f7a80";
const OTHER_VAULT = "2b3c4d5e6f7a8091";
const BROKEN_POOL = "3c4d5e6f7a8091a2";
const NO_POOL = "4d5e6f7a8091a2b3";

const slot = (size: number, iso: string) => ({
  size,
  lastModified: at(iso),
});

const device = (): OriginTree => ({
  zotlit: {
    [THIS_VAULT]: { ".opaque": { a1: slot(8192, "2026-11-01T09:00:00Z") } },
    [BROKEN_POOL]: { ".opaque": slot(4096, "2026-11-02T09:00:00Z") },
    [OTHER_VAULT]: {
      ".opaque": {
        b1: slot(1_048_576, "2026-10-01T09:00:00Z"),
        b2: slot(4096, "2026-10-04T18:15:00Z"),
      },
    },
    [NO_POOL]: { "notes.json": slot(10, "2026-10-01T09:00:00Z") },
    backups: { ".opaque": { c1: slot(4096, "2026-10-01T09:00:00Z") } },
    "language-pack": { "zh-CN.json": slot(900, "2026-10-01T09:00:00Z") },
  },
  other: { "data.bin": slot(1, "2026-10-01T09:00:00Z") },
});

describe("the replica pools of other folders in the origin private file system", () => {
  it.effect(
    "lists each other pool folder of a vault ID with the sum of its slot files and their newest change, and skips this vault and every folder that is not a pool",
    () =>
      Effect.gen(function* () {
        expect(
          yield* listOtherPools({
            open: originPools(device()),
            thisVault: THIS_VAULT,
          }),
        ).toEqual([
          {
            id: OTHER_VAULT,
            bytes: 1_052_672,
            changed: DateTime.makeUnsafe("2026-10-04T18:15:00Z"),
          },
        ]);
      }),
  );

  it.effect("lists nothing before any vault stores data", () =>
    Effect.gen(function* () {
      expect(
        yield* listOtherPools({ open: originPools({}), thisVault: THIS_VAULT }),
      ).toEqual([]);
    }),
  );

  it.effect(
    "removes a pool folder after its confirmation, and refuses each folder that is not another vault's pool at that time",
    () =>
      Effect.gen(function* () {
        const tree = device();
        const open = originPools(tree);
        for (const id of [THIS_VAULT, BROKEN_POOL, NO_POOL, "backups"])
          expect(
            yield* Effect.flip(
              removeOtherPool({ open, thisVault: THIS_VAULT, target: id }),
            ),
          ).toMatchObject({
            _tag: "OtherDataRefused",
            message: m.settings_online_data_remove_refused({ id }),
          });
        yield* removeOtherPool({
          open,
          thisVault: THIS_VAULT,
          target: OTHER_VAULT,
        });
        expect(Object.keys(tree.zotlit!).sort()).toEqual(
          [THIS_VAULT, BROKEN_POOL, NO_POOL, "backups", "language-pack"].sort(),
        );
      }),
  );

  it.effect(
    "answers success when the pool folder is already gone, also when no zotlit folder exists",
    () =>
      Effect.gen(function* () {
        const tree = device();
        const open = originPools(tree);
        yield* removeOtherPool({
          open,
          thisVault: THIS_VAULT,
          target: OTHER_VAULT,
        });
        yield* removeOtherPool({
          open,
          thisVault: THIS_VAULT,
          target: OTHER_VAULT,
        });
        yield* removeOtherPool({
          open: originPools({}),
          thisVault: THIS_VAULT,
          target: OTHER_VAULT,
        });
        expect(Object.keys(tree.zotlit!)).not.toContain(OTHER_VAULT);
      }),
  );

  it.effect(
    "names no path in the message when the pool of this vault cannot be removed",
    () =>
      Effect.gen(function* () {
        const path = `/zotlit/${THIS_VAULT}`;
        vi.stubGlobal("navigator", {
          storage: {
            getDirectory: async () => ({
              getDirectoryHandle: async () => ({
                removeEntry: async () => {
                  throw new DOMException(
                    `${path} is in use`,
                    "NoModificationAllowedError",
                  );
                },
              }),
            }),
          },
        });
        const error = yield* Effect.flip(removeOriginDirectory(path)).pipe(
          Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())),
        );
        expect(error.message).toBe(m.settings_online_data_this_remove_failed());
      }),
  );

  it.effect(
    "names the reason in the language of ZotLit when the origin storage cannot be read",
    () =>
      Effect.gen(function* () {
        const open = () =>
          Promise.reject(new DOMException("denied", "SecurityError"));
        expect(
          (yield* Effect.flip(listOtherPools({ open, thisVault: THIS_VAULT })))
            .message,
        ).toBe(m.settings_online_data_others_unreadable());
      }),
  );
});
