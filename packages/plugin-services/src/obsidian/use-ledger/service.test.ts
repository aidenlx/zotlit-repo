import { it } from "@effect/vitest";
import {
  Effect,
  Exit,
  Fiber,
  Logger,
  Option,
  Queue,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { TFile } from "obsidian";
import { expect } from "vitest";

import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import { MemoryMetadataCache } from "@zotlit/obsidian-kit/__fixtures__/obsidian-metadata-cache.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { FIELD_ZOTERO_KEY } from "@zotlit/plugin-kernel/constants.ts";
import { LogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

import { ledgerHost, useLedgerOf } from "./__fixtures__.ts";

const itemKey = (n: number) =>
  n
    .toString(6)
    .split("")
    .map((digit) => "ABCDEF"[Number(digit)])
    .join("")
    .padStart(8, "A");

class UnreadableStorage extends MemoryDeviceStorage {
  override loadLocalStorage(): unknown {
    throw new SyntaxError("Unexpected token");
  }
}

class FullStorage extends MemoryDeviceStorage {
  override saveLocalStorage(): void {
    throw new DOMException(
      "The quota has been exceeded.",
      "QuotaExceededError",
    );
  }
}

it.effect("keeps the 300 most recently used Items across reloads", () =>
  Effect.gen(function* () {
    const host = ledgerHost();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const ledger = yield* useLedgerOf(host);
        for (let item = 0; item < 300; item++) {
          yield* TestClock.adjust(1);
          yield* ledger.record(itemKey(item), "opened");
        }
        yield* TestClock.adjust(1);
        yield* ledger.record("AAAAAAAA", "opened");
        yield* TestClock.adjust(1);
        yield* ledger.record("NEWKEYZZ", "opened");
        expect(Object.keys(yield* ledger.current)).toHaveLength(300);
        expect(yield* ledger.get("AAAAAAAB")).toBeUndefined();
        expect((yield* ledger.get("AAAAAAAA"))?.instant.epochMilliseconds).toBe(
          301,
        );
        expect((yield* ledger.get("NEWKEYZZ"))?.instant.epochMilliseconds).toBe(
          302,
        );
      }),
    );

    const reloaded = yield* useLedgerOf(host);
    expect(Object.keys(yield* reloaded.current)).toHaveLength(300);
    expect(yield* reloaded.get("AAAAAAAB")).toBeUndefined();
    expect((yield* reloaded.get("AAAAAAAA"))?.instant.epochMilliseconds).toBe(
      301,
    );
  }),
);

it.effect("saves each instant in the ISO form it has always had", () =>
  Effect.gen(function* () {
    const host = ledgerHost();
    const storage = host.deviceStorage;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const ledger = yield* useLedgerOf(host);
        yield* TestClock.adjust(1000);
        yield* ledger.record("AAAAAAAA", "opened");
        yield* TestClock.adjust(120);
        yield* ledger.record("AAAAAAAB", "cited");
      }),
    );
    expect([...storage.values.keys()]).toEqual(["zotlit-use-ledger"]);
    expect(storage.loadLocalStorage("zotlit-use-ledger")).toEqual({
      AAAAAAAA: { instant: "1970-01-01T00:00:01Z", kind: "opened" },
      AAAAAAAB: { instant: "1970-01-01T00:00:01.12Z", kind: "cited" },
    });

    const reloaded = yield* useLedgerOf(host);
    expect((yield* reloaded.get("AAAAAAAB"))?.instant.epochMilliseconds).toBe(
      1120,
    );
  }),
);

it.effect(
  "stops recording and releases its listeners when its scope closes",
  () =>
    Effect.gen(function* () {
      const metadataCache = new MemoryMetadataCache();
      const workspace = new MemoryWorkspace();
      const host = ledgerHost({ workspace, metadataCache });

      const ledger = yield* Effect.scoped(useLedgerOf(host));
      yield* ledger.record("AAAAAAAA", "opened");

      expect(workspace.listenerCount("file-open")).toBe(0);
      expect(metadataCache.listenerCount("changed")).toBe(0);
      expect(yield* ledger.current).toEqual({});
      expect(host.deviceStorage.values.size).toBe(0);
    }),
);

it.effect(
  "starts empty and logs a warning when the saved Uses cannot be read",
  () =>
    Effect.gen(function* () {
      const logged: { level: string; category: readonly string[] }[] = [];
      const capture = Logger.make(({ logLevel, fiber }) => {
        logged.push({ level: logLevel, category: fiber.getRef(LogCategory) });
      });
      const host = ledgerHost({ deviceStorage: new UnreadableStorage() });

      const ledger = yield* useLedgerOf(host).pipe(
        Effect.provide(Logger.layer([capture])),
      );

      expect(yield* ledger.current).toEqual({});
      expect(logged).toEqual([{ level: "Warn", category: ["use-ledger"] }]);
    }),
);

it.effect(
  "fails a record whose save throws with the storage failure and keeps the ledger",
  () =>
    Effect.gen(function* () {
      const host = ledgerHost({ deviceStorage: new FullStorage() });
      const ledger = yield* useLedgerOf(host);

      const exit = yield* Effect.exit(ledger.record("AAAAAAAA", "opened"));

      expect(Option.getOrUndefined(Exit.findErrorOption(exit))).toMatchObject({
        _tag: "DeviceStorageError",
        operation: "saveLocalStorage",
      });
      expect(yield* ledger.current).toEqual({});
    }),
);

it.effect("records an opened Item note only once the layout is ready", () =>
  Effect.gen(function* () {
    const metadataCache = new MemoryMetadataCache();
    const workspace = new MemoryWorkspace();
    const note = new TFile();
    note.path = "Paper.md";
    note.extension = "md";
    metadataCache.setCache(note.path, {
      frontmatter: { [FIELD_ZOTERO_KEY]: "AAAAAAAA" },
    });
    const ledger = yield* useLedgerOf(ledgerHost({ workspace, metadataCache }));

    workspace.open(note);
    expect(yield* ledger.get("AAAAAAAA")).toBeUndefined();

    workspace.layoutReady();
    workspace.open(note);
    expect((yield* ledger.get("AAAAAAAA"))?.kind).toBe("opened");
  }),
);

it.effect(
  "counts a deferred open before an update and not the update's own",
  () =>
    Effect.gen(function* () {
      const metadataCache = new MemoryMetadataCache();
      const workspace = new MemoryWorkspace({ layoutReady: true });
      const note = new TFile();
      note.path = "Paper.md";
      note.extension = "md";
      metadataCache.setCache(note.path, {
        frontmatter: { [FIELD_ZOTERO_KEY]: "AAAAAAAA" },
      });
      const ledger = yield* useLedgerOf(
        ledgerHost({ workspace, metadataCache }),
      );

      yield* TestClock.adjust(1);
      workspace.deferOpen(note);
      yield* ledger.withoutNoteUse(
        note,
        Effect.gen(function* () {
          yield* TestClock.adjust(1);
          workspace.open(note);
        }),
      );

      expect((yield* ledger.get("AAAAAAAA"))?.instant.epochMilliseconds).toBe(
        1,
      );
    }),
);

it.effect(
  "changes replays the current Uses, delivers updates and ends when the scope closes",
  () =>
    Effect.gen(function* () {
      const host = ledgerHost();
      const scope = yield* Scope.make();
      const ledger = yield* useLedgerOf(host).pipe(Scope.provide(scope));
      const delivered = yield* Queue.unbounded<number>();
      const listening = yield* Stream.runForEach(ledger.changes, (entries) =>
        Queue.offer(delivered, Object.keys(entries).length),
      ).pipe(Effect.forkScoped({ startImmediately: true }));
      yield* ledger.record("AAAAAAAA", "opened");
      yield* ledger.record("BBBBBBBB", "opened");
      expect(yield* Queue.take(delivered)).toBe(0);
      expect(yield* Queue.take(delivered)).toBe(1);
      expect(yield* Queue.take(delivered)).toBe(2);
      const late = yield* Stream.runCollect(Stream.take(ledger.changes, 1));
      expect(Object.keys(late[0]!)).toHaveLength(2);
      yield* Scope.close(scope, Exit.void);
      yield* Fiber.join(listening);
      expect(yield* Queue.size(delivered)).toBe(0);
    }),
);
