import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Layer, Scope } from "effect";
import { describe, expect } from "vitest";

import { layerTestObsidianEnv } from "@zotlit/obsidian-kit/__fixtures__/obsidian-env.ts";
import { layerTestVaultDisk } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault-disk.ts";
import { openTestBridge } from "@zotlit/plugin-kernel/__fixtures__/effect-bridge.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import {
  inProcessClient,
  memoryOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { layerZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { layerRcRef } from "@zotlit/zotero-reads/worker/connection.ts";

import { bindLiteratureNoteAttachments } from "./handle.ts";
import { literatureNoteAttachments } from "./literature-note.ts";

const ITEM_WITH_PDF = `
  insert into libraries (libraryID, type) values (1, 'user');
  insert into itemTypes (itemTypeID, typeName)
    values (1, 'journalArticle'), (2, 'attachment');
  insert into items (itemID, itemTypeID, libraryID, key, dateAdded, dateModified)
    values (7, 1, 1, 'ABCD2345', '2024-01-01 00:00:00', '2024-01-01 00:00:00'), (20, 2, 1, 'ATCH2345', '2024-01-01 00:00:00', '2024-01-01 00:00:00'), (8, 1, 1, 'NOPDF234', '2024-01-01 00:00:00', '2024-01-01 00:00:00');
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values (20, 7, 0, 'application/pdf', 'storage:Doe 2024.pdf');
`;

function services(
  seed: string | null = ITEM_WITH_PDF,
  zoteroPref: Effect.Effect<ZoteroPrefSnapshot> = Effect.succeed(
    stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
      dataDir: "/data",
      baseAttachmentPath: null,
    }),
  ),
) {
  return Layer.mergeAll(
    layerZoteroReads(
      inProcessClient(layerRcRef(memoryOpener(() => seed).open)),
    ),
    Layer.mock(ZoteroPref, { current: zoteroPref }),
    layerTestObsidianEnv(),
    layerTestVaultDisk({ basePath: "/vault" }),
  );
}

const OPENABLE_FIXTURE = [
  {
    indexedKey: "ATCH2345",
    label: "Doe 2024.pdf",
    openPath: "file:/data/storage/ATCH2345/Doe 2024.pdf",
    absolutePath: "/data/storage/ATCH2345/Doe 2024.pdf",
  },
];

describe("literatureNoteAttachments", () => {
  it.effect("answers no Attachments while the database cannot be read", () =>
    Effect.gen(function* () {
      const result = yield* literatureNoteAttachments("ABCD2345").pipe(
        Effect.provide(services(null)),
      );
      expect(result).toStrictEqual([]);
    }),
  );

  it.effect(
    "answers no Attachments when the Indexed Key names no Library",
    () =>
      Effect.gen(function* () {
        const result = yield* literatureNoteAttachments("ABCD2345g999").pipe(
          Effect.provide(services()),
        );
        expect(result).toStrictEqual([]);
      }),
  );

  it.effect(
    "answers no Attachments when the key resolves to no live Item",
    () =>
      Effect.gen(function* () {
        const result = yield* literatureNoteAttachments("ZZZZ2345").pipe(
          Effect.provide(services()),
        );
        expect(result).toStrictEqual([]);
      }),
  );

  it.effect("answers no Attachments for an Item that holds none", () =>
    Effect.gen(function* () {
      const result = yield* literatureNoteAttachments("NOPDF234").pipe(
        Effect.provide(services()),
      );
      expect(result).toStrictEqual([]);
    }),
  );

  it.effect("resolves the Item's Attachments through the database", () =>
    Effect.gen(function* () {
      const result = yield* literatureNoteAttachments("ABCD2345").pipe(
        Effect.provide(services()),
      );
      expect(result).toStrictEqual(OPENABLE_FIXTURE);
    }),
  );
});

describe("bindLiteratureNoteAttachments", () => {
  const handleOver = Effect.fnUntraced(function* (
    layer: ReturnType<typeof services> = services(),
  ) {
    const bridge = yield* Effect.acquireDisposable(
      Effect.sync(() => openTestBridge()),
    );
    const scope = yield* Scope.fork(yield* Scope.Scope);
    const context = yield* Layer.buildWithScope(layer, scope);
    return {
      handle: bindLiteratureNoteAttachments(bridge, context),
      unload: Effect.andThen(
        Scope.close(scope, Exit.void),
        Effect.promise(() => bridge[Symbol.asyncDispose]()),
      ),
    };
  });

  it.effect("resolves with the Item's Attachments", () =>
    Effect.gen(function* () {
      const { handle } = yield* handleOver();
      expect(
        yield* Effect.promise(() =>
          handle.literatureNoteAttachments("ABCD2345"),
        ),
      ).toStrictEqual(OPENABLE_FIXTURE);
    }),
  );

  it.effect(
    "answers undefined, apart from an Item with no Attachments, when unload stops the lookup",
    () =>
      Effect.gen(function* () {
        const reading = yield* Deferred.make<void>();
        const { handle, unload } = yield* handleOver(
          services(
            ITEM_WITH_PDF,
            Deferred.succeed(reading, undefined).pipe(
              Effect.andThen(Effect.never),
            ),
          ),
        );

        const lookup = handle.literatureNoteAttachments("ABCD2345");
        yield* Deferred.await(reading);
        yield* unload;

        expect(yield* Effect.promise(() => lookup)).toBeUndefined();
      }),
  );

  it.effect("answers no Attachments once the plugin unloads", () =>
    Effect.gen(function* () {
      const { handle, unload } = yield* handleOver();
      yield* unload;
      expect(
        yield* Effect.promise(() =>
          handle.literatureNoteAttachments("ABCD2345"),
        ),
      ).toStrictEqual([]);
    }),
  );
});
