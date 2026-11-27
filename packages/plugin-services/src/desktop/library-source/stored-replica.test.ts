import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import type { Scope } from "effect";
import { DateTime, Effect, FileSystem } from "effect";
import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect } from "vitest";

import * as m from "@zotlit/plugin-messages/messages.ts";

import {
  listGoneVaultReplicas,
  removeGoneVaultReplica,
  removeVaultReplica,
  replicaFolder,
  replicaPath,
} from "./stored-replica.ts";

describe("the replica folder of a vault on desktop", () => {
  it("is zotlit/<vault id> under the user-data folder", () => {
    expect(replicaFolder("/home/reader/.config/obsidian", "a1b2c3")).toBe(
      join("/home/reader/.config/obsidian", "zotlit", "a1b2c3"),
    );
  });

  it("keeps the replica file zotero-replica.sqlite in that folder", () => {
    expect(replicaPath(join("/data", "zotlit", "a1b2c3"))).toBe(
      join("/data", "zotlit", "a1b2c3", "zotero-replica.sqlite"),
    );
  });
});

const at = (iso: string) => DateTime.makeUnsafe(iso).epochMilliseconds / 1000;

const THIS_VAULT = "1a2b3c4d5e6f7a80";
const OPEN_ELSEWHERE = "2b3c4d5e6f7a8091";
const REMOVED_VAULT = "3c4d5e6f7a8091a2";
const EMPTIED_VAULT = "4d5e6f7a8091a2b3";
const LINKED_VAULT = "5e6f7a8091a2b3c4";
const LINKED_MARKER = "6f7a8091a2b3c4d5";

const registryOf = (...ids: string[]) =>
  JSON.stringify({
    vaults: Object.fromEntries(
      ids.map((id, index) => [id, { path: `/home/ada/Vault ${index}`, ts: 1 }]),
    ),
    updateDisabled: true,
  });

const onDisk = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Scope.Scope>,
) => effect.pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer));

describe("the replica folders of vaults that Obsidian no longer knows", () => {
  const setUp = Effect.fn("setUp")(function* (registry: string | null) {
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
      prefix: "zotlit-user-data-",
    });
    const writeRegistry = (text: string) =>
      writeFileSync(join(root, "obsidian.json"), text);
    if (registry !== null) writeRegistry(registry);
    const folder = (name: string, files: Record<string, [string, number]>) => {
      const path = replicaFolder(root, name);
      mkdirSync(path, { recursive: true });
      for (const [file, [text, changed]] of Object.entries(files)) {
        writeFileSync(join(path, file), text);
        utimesSync(join(path, file), changed, changed);
      }
      return path;
    };
    const list = () =>
      listGoneVaultReplicas({ userData: root, thisVault: THIS_VAULT });
    const remove = (id: string) =>
      removeGoneVaultReplica({
        userData: root,
        thisVault: THIS_VAULT,
        target: id,
      });
    return { root, folder, writeRegistry, list, remove };
  });
  const replica = (text = "replica") => ({
    "zotero-replica.sqlite": [text, at("2026-09-01T08:00:00Z")] as [
      string,
      number,
    ],
  });

  it.effect(
    "lists only the folders of a vault ID that obsidian.json does not hold and that keep a replica, with the size of their files and the newest change",
    () =>
      onDisk(
        Effect.gen(function* () {
          const { root, folder, list } = yield* setUp(
            registryOf(THIS_VAULT, OPEN_ELSEWHERE),
          );
          folder(THIS_VAULT, replica("mine"));
          folder(OPEN_ELSEWHERE, replica("other"));
          folder(REMOVED_VAULT, {
            "zotero-replica.sqlite": ["1234567890", at("2026-09-01T08:00:00Z")],
            "zotero-replica.sqlite-wal": ["12345", at("2026-09-03T10:30:00Z")],
          });
          folder(EMPTIED_VAULT, { notes: ["not a replica", 1] });
          folder("backups", replica("a backup that someone keeps here"));
          writeFileSync(join(root, "zotlit", "5e6f7a8091a2b3c4"), "a file");

          expect(yield* list()).toEqual([
            {
              id: REMOVED_VAULT,
              bytes: 15,
              changed: DateTime.makeUnsafe("2026-09-03T10:30:00Z"),
            },
          ]);
        }),
      ),
  );

  it.effect("lists nothing when no vault has synced an online library", () =>
    onDisk(
      Effect.gen(function* () {
        const { list } = yield* setUp(registryOf(THIS_VAULT));
        expect(yield* list()).toEqual([]);
      }),
    ),
  );

  it.effect(
    "offers no folder when obsidian.json is missing, not JSON, or holds no vault list of the form that Obsidian writes",
    () =>
      onDisk(
        Effect.gen(function* () {
          const { folder, writeRegistry, list } = yield* setUp(null);
          folder(REMOVED_VAULT, replica());
          const reasons: string[] = [];
          reasons.push((yield* Effect.flip(list())).message);
          for (const text of [
            "{ not json",
            '{"vaults":[]}',
            '{"vaults":{"x":1}}',
          ]) {
            writeRegistry(text);
            reasons.push((yield* Effect.flip(list())).message);
          }
          expect(reasons).toEqual(
            Array(4).fill(m.settings_online_data_registry_unreadable()),
          );
        }),
      ),
  );

  it.effect(
    "removes a listed folder after its confirmation, and keeps it when obsidian.json holds its vault again by then",
    () =>
      onDisk(
        Effect.gen(function* () {
          const { folder, writeRegistry, list, remove } = yield* setUp(
            registryOf(THIS_VAULT),
          );
          const restored = folder(OPEN_ELSEWHERE, replica());
          const removed = folder(REMOVED_VAULT, replica());
          expect((yield* list()).map(({ id }) => id).sort()).toEqual(
            [OPEN_ELSEWHERE, REMOVED_VAULT].sort(),
          );

          writeRegistry(registryOf(THIS_VAULT, OPEN_ELSEWHERE));
          expect(yield* Effect.flip(remove(OPEN_ELSEWHERE))).toMatchObject({
            _tag: "OtherDataRefused",
            message: m.settings_online_data_remove_refused({
              id: OPEN_ELSEWHERE,
            }),
          });
          expect(existsSync(restored)).toBe(true);

          yield* remove(REMOVED_VAULT);
          expect(existsSync(removed)).toBe(false);
        }),
      ),
  );

  it.effect(
    "refuses to remove a folder that is not a vault ID, this vault, or a folder with no replica",
    () =>
      onDisk(
        Effect.gen(function* () {
          const { folder, remove } = yield* setUp(registryOf(THIS_VAULT));
          const kept = [
            folder("backups", replica()),
            folder(THIS_VAULT, replica()),
            folder(EMPTIED_VAULT, { notes: ["not a replica", 1] }),
          ];
          for (const id of ["backups", THIS_VAULT, EMPTIED_VAULT, "../zotlit"])
            expect(yield* Effect.flip(remove(id))).toMatchObject({
              _tag: "OtherDataRefused",
              message: m.settings_online_data_remove_refused({ id }),
            });
          expect(kept.every((path) => existsSync(path))).toBe(true);
        }),
      ),
  );

  it.effect(
    "answers success when the folder of a removed vault is already gone, also when no zotlit folder exists",
    () =>
      onDisk(
        Effect.gen(function* () {
          const { folder, remove } = yield* setUp(registryOf(THIS_VAULT));
          yield* remove(REMOVED_VAULT);
          const kept = folder(THIS_VAULT, replica());
          yield* remove(REMOVED_VAULT);
          expect(existsSync(kept)).toBe(true);
        }),
      ),
  );

  it.effect("refuses every removal while obsidian.json cannot be read", () =>
    onDisk(
      Effect.gen(function* () {
        const { folder, remove } = yield* setUp('{"vaults":[]}');
        const kept = folder(REMOVED_VAULT, replica());
        expect((yield* Effect.flip(remove(REMOVED_VAULT))).message).toBe(
          m.settings_online_data_registry_unreadable(),
        );
        expect(existsSync(kept)).toBe(true);
      }),
    ),
  );

  it.effect(
    "follows no symbolic link: a linked vault folder or replica file is never offered or removed, and a link inside a listed folder counts no bytes",
    () =>
      onDisk(
        Effect.gen(function* () {
          const { root, folder, list, remove } = yield* setUp(
            registryOf(THIS_VAULT, OPEN_ELSEWHERE),
          );
          const live = folder(OPEN_ELSEWHERE, replica("a live replica"));
          symlinkSync(live, replicaFolder(root, LINKED_VAULT));
          const outside = join(root, "elsewhere");
          mkdirSync(outside);
          writeFileSync(join(outside, "large.bin"), new Uint8Array(4096));
          const marked = folder(LINKED_MARKER, {
            "notes.txt": ["kept", at("2026-09-01T08:00:00Z")],
          });
          symlinkSync(join(outside, "large.bin"), replicaPath(marked));
          const gone = folder(REMOVED_VAULT, {
            "zotero-replica.sqlite": ["1234567890", at("2026-09-03T10:30:00Z")],
          });
          symlinkSync(join(outside, "large.bin"), join(gone, "linked.bin"));
          symlinkSync(join(outside, "missing.bin"), join(gone, "dangling.bin"));

          expect(yield* list()).toEqual([
            {
              id: REMOVED_VAULT,
              bytes: 10,
              changed: DateTime.makeUnsafe("2026-09-03T10:30:00Z"),
            },
          ]);
          for (const id of [LINKED_VAULT, LINKED_MARKER])
            expect(yield* Effect.flip(remove(id))).toMatchObject({
              _tag: "OtherDataRefused",
            });
          expect(existsSync(replicaPath(live))).toBe(true);
          expect(existsSync(join(marked, "notes.txt"))).toBe(true);
          expect(existsSync(join(outside, "large.bin"))).toBe(true);
        }),
      ),
  );

  it.effect(
    "lists and removes nothing when the zotlit folder itself is a link to the replica store of another profile",
    () =>
      onDisk(
        Effect.gen(function* () {
          const { root, list, remove } = yield* setUp(registryOf(THIS_VAULT));
          const otherProfile = join(root, "other-profile");
          const other = join(otherProfile, "zotlit", REMOVED_VAULT);
          mkdirSync(other, { recursive: true });
          writeFileSync(replicaPath(other), "a replica of another profile");
          symlinkSync(join(otherProfile, "zotlit"), join(root, "zotlit"));

          expect(yield* list()).toEqual([]);
          expect(yield* Effect.flip(remove(REMOVED_VAULT))).toMatchObject({
            _tag: "OtherDataRefused",
          });
          expect(existsSync(replicaPath(other))).toBe(true);
        }),
      ),
  );
});

describe("the removal of this vault's replica folder", () => {
  const setUp = Effect.fn("setUp")(function* () {
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
      prefix: "zotlit-user-data-",
    });
    const stored = (id: string, under = root) => {
      const folder = replicaFolder(under, id);
      mkdirSync(folder, { recursive: true });
      for (const name of ["zotero-replica.sqlite", "zotero-replica.sqlite-wal"])
        writeFileSync(join(folder, name), "replica");
      return folder;
    };
    const remove = (thisVault: string) =>
      removeVaultReplica({ userData: root, thisVault });
    return { root, stored, remove };
  });

  it.effect(
    "removes the folder of this vault with its files, and keeps the folder of another vault",
    () =>
      onDisk(
        Effect.gen(function* () {
          const { stored, remove } = yield* setUp();
          const mine = stored(THIS_VAULT);
          const other = stored(OPEN_ELSEWHERE);
          yield* remove(THIS_VAULT);
          expect(existsSync(mine)).toBe(false);
          expect(existsSync(replicaPath(other))).toBe(true);
        }),
      ),
  );

  it.effect(
    "succeeds when the folder of this vault or the zotlit folder is already gone",
    () =>
      onDisk(
        Effect.gen(function* () {
          const { root, stored, remove } = yield* setUp();
          yield* remove(THIS_VAULT);
          stored(OPEN_ELSEWHERE);
          yield* remove(THIS_VAULT);
          expect(existsSync(replicaFolder(root, OPEN_ELSEWHERE))).toBe(true);
        }),
      ),
  );

  it.effect(
    "refuses a vault ID that is not of the form that Obsidian makes, and keeps the replica store",
    () =>
      onDisk(
        Effect.gen(function* () {
          const { root, stored, remove } = yield* setUp();
          const other = stored(OPEN_ELSEWHERE);
          for (const id of ["", ".", "..", "../zotlit", "this-vault"])
            expect(yield* Effect.flip(remove(id))).toMatchObject({
              _tag: "ReplicaFolderRefused",
              message: m.settings_online_data_this_remove_refused({ id }),
            });
          expect(existsSync(replicaPath(other))).toBe(true);
          expect(existsSync(join(root, "zotlit"))).toBe(true);
        }),
      ),
  );

  it.effect(
    "follows no link: a zotlit folder that links to the store of another profile, or a vault folder that is a link, stays with its target",
    () =>
      onDisk(
        Effect.gen(function* () {
          const { root, stored, remove } = yield* setUp();
          const otherProfile = join(root, "other-profile");
          const theirs = stored(THIS_VAULT, otherProfile);
          symlinkSync(join(otherProfile, "zotlit"), join(root, "zotlit"));
          const linkedStore = yield* Effect.flip(remove(THIS_VAULT));
          expect(existsSync(replicaPath(theirs))).toBe(true);

          rmSync(join(root, "zotlit"));
          mkdirSync(join(root, "zotlit"));
          symlinkSync(theirs, replicaFolder(root, THIS_VAULT));
          const linkedFolder = yield* Effect.flip(remove(THIS_VAULT));
          expect(existsSync(replicaPath(theirs))).toBe(true);

          const refused = expect.objectContaining({
            _tag: "ReplicaFolderRefused",
            message: m.settings_online_data_this_remove_refused({
              id: THIS_VAULT,
            }),
          });
          expect([linkedStore, linkedFolder]).toEqual([refused, refused]);
        }),
      ),
  );

  it.effect("names no path in the message of a removal that fails", () =>
    onDisk(
      Effect.gen(function* () {
        const { root, remove } = yield* setUp();
        mkdirSync(join(root, "zotlit"));
        writeFileSync(replicaFolder(root, THIS_VAULT), "a file in its place");
        const error = yield* Effect.flip(remove(THIS_VAULT));
        expect(error).toMatchObject({
          _tag: "ReplicaFolderRefused",
          message: m.settings_online_data_this_remove_refused({
            id: THIS_VAULT,
          }),
        });
        expect(error.message).not.toContain(root);
      }),
    ),
  );
});
