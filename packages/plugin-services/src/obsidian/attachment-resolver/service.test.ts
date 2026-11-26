import { it } from "@effect/vitest";
import { DateTime, Effect, Fiber, Option, Stream } from "effect";
import { TestClock } from "effect/testing";
import { TExternalFile, TFile } from "obsidian";
import { expect } from "vitest";

import type { AttachmentWithParentKey } from "@zotlit/db";
import { toInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import type { OperatingSystem } from "@zotlit/shared/platform";

import {
  DATA_DIR,
  nextAnnouncement,
  openResolver,
  resolverFixture,
} from "./__fixtures__.ts";
import type { ResolverHarnessOptions } from "./__fixtures__.ts";
import { buildPathIndex } from "./service.ts";

const VAULT_DIR = "/fixture/zt-fixture-vault";
const LINKED_FILES_DIR = "/fixture/linked-files";
const BASE_ATTACHMENT_DIR = "/fixture/base-attachments";

const FIXTURE_ROWS = `
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (20, 1, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'SAKIMA22'),
      (21, 2, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'PDFSTR22'),
      (22, 2, '2025-02-19 12:00:00', '2025-02-19 12:00:00', 1, 'HTMLSNAP'),
      (23, 2, '2025-02-18 12:00:00', '2025-02-18 12:00:00', 1, 'PDFLINKD'),
      (24, 2, '2025-02-17 12:00:00', '2025-02-17 12:00:00', 1, 'LINKURL2'),
      (28, 1, '2025-02-12 12:00:00', '2025-02-12 12:00:00', 1, 'IANNP5A2'),
      (29, 2, '2025-02-12 12:00:00', '2025-02-12 12:00:00', 1, 'IANPDF25'),
      (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
      (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24'),
      (80, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'LSEPDF22');

  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values
      (21, 20, 0, 'application/pdf', 'storage:sakimas-song.pdf'),
      (22, 20, 1, 'text/html', 'storage:sakimas-song.html'),
      (23, 20, 2, 'application/pdf', '${LINKED_FILES_DIR}/sakimas-song.pdf'),
      (24, 20, 3, 'text/html', null),
      -- The Fixture declares no base-directory attachment. This row departs
      -- from it to carry Zotero's own \`attachments:\` placeholder, the form
      -- \`parseAttachmentPath\` reads, onto the Fixture's Ioannidis Item.
      (29, 28, 2, 'application/pdf', 'attachments:ioannidis-2005/ioannidis-2005.pdf'),
      (47, 46, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf'),
      -- Also not in the Fixture: a standalone attachment, which Zotero allows
      -- and which names no parent Item (Ruling 14).
      (80, null, 0, 'application/pdf', 'storage:loose-reading.pdf');
`;

const ROUGIER = {
  kind: "resolved",
  serverID: null,
  attachmentKey: "RGRPDF24",
  itemKey: "RUGIER24",
  openable: true,
};

it.effect(
  "resolves every link mode the Fixture carries, inside the vault and outside it",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup({
        baseAttachmentPath: BASE_ATTACHMENT_DIR,
      });
      const paths = [
        `${DATA_DIR}/storage/PDFSTR22/sakimas-song.pdf`,
        `${DATA_DIR}/storage/HTMLSNAP/sakimas-song.html`,
        `${LINKED_FILES_DIR}/sakimas-song.pdf`,
        `${VAULT_DIR}/attachments/rougier-2014.pdf`,
        `${BASE_ATTACHMENT_DIR}/ioannidis-2005/ioannidis-2005.pdf`,
        `${DATA_DIR}/storage/LSEPDF22/loose-reading.pdf`,
        "https://www.storybookscanada.ca/stories/en/0315/",
        `${VAULT_DIR}/attachments/never-imported.pdf`,
      ];

      expect(
        yield* Effect.forEach(paths, (path) => resolver.resolve(path)),
      ).toEqual([
        {
          kind: "resolved",
          serverID: null,
          attachmentKey: "PDFSTR22",
          itemKey: "SAKIMA22",
          openable: true,
        },
        {
          kind: "resolved",
          serverID: null,
          attachmentKey: "HTMLSNAP",
          itemKey: "SAKIMA22",
          openable: false,
        },
        {
          kind: "resolved",
          serverID: null,
          attachmentKey: "PDFLINKD",
          itemKey: "SAKIMA22",
          openable: true,
        },
        ROUGIER,
        {
          kind: "resolved",
          serverID: null,
          attachmentKey: "IANPDF25",
          itemKey: "IANNP5A2",
          openable: true,
        },
        {
          kind: "resolved",
          serverID: null,
          attachmentKey: "LSEPDF22",
          itemKey: null,
          openable: true,
        },
        { kind: "unresolved" },
        { kind: "unresolved" },
      ]);
    }),
);

it.effect(
  "looks an Attachment up by its Indexed Key, with its file and its openable verdict",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup({ baseAttachmentPath: null });

      expect(
        yield* Effect.forEach(
          ["RGRPDF24", "HTMLSNAP", "LINKURL2", "IANPDF25", "ZZZZZZZZ"],
          (key) => resolver.lookup(key),
        ),
      ).toEqual([
        {
          ...ROUGIER,
          absolutePath: `${VAULT_DIR}/attachments/rougier-2014.pdf`,
        },
        {
          kind: "resolved",
          serverID: null,
          attachmentKey: "HTMLSNAP",
          itemKey: "SAKIMA22",
          openable: false,
          absolutePath: `${DATA_DIR}/storage/HTMLSNAP/sakimas-song.html`,
        },
        { kind: "unresolved" },
        { kind: "unresolved" },
        { kind: "unresolved" },
      ]);
    }),
);

it.effect(
  "looks a group-library Attachment up by its group's Indexed Key alone",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup({
        rows: `
      insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
      insert into groups (groupID, libraryID, name)
        values (4200309, 2, 'Shared Reading');
      insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
        values
          (30, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RGRGRUP9'),
          (31, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RUGIERG9');
      insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
        values (30, 31, 0, 'application/pdf', 'storage:shared.pdf');
    `,
      });

      expect(yield* resolver.lookup("RGRGRUP9g4200309")).toEqual({
        kind: "resolved",
        serverID: null,
        attachmentKey: "RGRGRUP9g4200309",
        itemKey: "RUGIERG9g4200309",
        openable: true,
        absolutePath: `${DATA_DIR}/storage/RGRGRUP9/shared.pdf`,
      });
      expect(yield* resolver.lookup("RGRGRUP9")).toEqual({
        kind: "unresolved",
      });
    }),
);

it.effect(
  "leaves a base-directory attachment unresolved while the base pref is unset",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup({ baseAttachmentPath: null });

      expect(
        yield* resolver.resolve(
          `${BASE_ATTACHMENT_DIR}/ioannidis-2005/ioannidis-2005.pdf`,
        ),
      ).toEqual({ kind: "unresolved" });
    }),
);

it.effect(
  "meets a backslash-stored Windows row with the forward slashes Obsidian supplies",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup({
        platform: "win32",
        rows: `
      insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
        values
          (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
          (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24');
      insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
        values (47, 46, 2, 'application/pdf',
          'C:\\Users\\me\\zt-fixture-vault\\attachments\\rougier-2014.pdf');
    `,
      });

      expect(
        yield* resolver.resolve(
          "C:/Users/me/zt-fixture-vault/attachments/rougier-2014.pdf",
        ),
      ).toEqual(ROUGIER);
    }),
);

it.effect.each<[OperatingSystem, object]>([
  ["darwin", ROUGIER],
  ["win32", ROUGIER],
  ["linux", { kind: "unresolved" }],
])("answers a differently cased path on %s", ([platform, expected]) =>
  Effect.gen(function* () {
    const { service: resolver } = yield* setup({ platform });

    expect(
      yield* resolver.resolve(`${VAULT_DIR}/Attachments/Rougier-2014.PDF`),
    ).toEqual(expected);
  }),
);

it.effect(
  "prefers the personal library, then the lowest item ID, when several attachments name one file",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup({
        rows: `
      insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
      insert into groups (groupID, libraryID, name)
        values (4200309, 2, 'Shared Reading');

      insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
        values
          (30, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RGRGRUP9'),
          (31, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RUGIERG9'),
          (40, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGREARL8'),
          (41, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIERE8'),
          (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
          (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24');

      insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
        values
          (30, 31, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf'),
          (47, 46, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf'),
          (40, 41, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf');
    `,
      });

      expect(
        yield* resolver.resolve(`${VAULT_DIR}/attachments/rougier-2014.pdf`),
      ).toEqual({
        kind: "resolved",
        serverID: null,
        attachmentKey: "RGREARL8",
        itemKey: "RUGIERE8",
        openable: true,
      });
    }),
);

const SHARED_FILE_ROWS = `
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (40, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGREARL8'),
      (41, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIERE8'),
      (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
      (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24'),
      (21, 2, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'PDFSTR22'),
      (20, 1, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'SAKIMA22');
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values
      (40, 41, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf'),
      (47, 46, 2, 'application/pdf', '${VAULT_DIR}/attachments/rougier-2014.pdf'),
      (21, 20, 0, 'application/pdf', 'storage:sakimas-song.pdf');
`;

it.effect(
  "answers the Attachment a shared file's path does not choose by its own key",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup({ rows: SHARED_FILE_ROWS });

      expect(yield* resolver.lookup("RGRPDF24")).toEqual({
        ...ROUGIER,
        absolutePath: `${VAULT_DIR}/attachments/rougier-2014.pdf`,
      });
    }),
);

it.effect("resolves a shared file to the Attachment the opener named", () =>
  Effect.gen(function* () {
    const { service: resolver } = yield* setup({ rows: SHARED_FILE_ROWS });
    const path = `${VAULT_DIR}/attachments/rougier-2014.pdf`;

    expect(
      yield* resolver.resolve(path, { attachmentKey: "RGRPDF24" }),
    ).toEqual(ROUGIER);
    expect(yield* resolver.resolve(path)).toMatchObject({
      attachmentKey: "RGREARL8",
    });
  }),
);

it.effect(
  "resolves by the path alone when the named Attachment keeps another file",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup({ rows: SHARED_FILE_ROWS });

      expect(
        yield* resolver.resolve(`${VAULT_DIR}/attachments/rougier-2014.pdf`, {
          attachmentKey: "PDFSTR22",
        }),
      ).toMatchObject({ attachmentKey: "RGREARL8" });
      expect(
        yield* resolver.resolve(`${VAULT_DIR}/attachments/rougier-2014.pdf`, {
          attachmentKey: "ZZZZZZZZ",
        }),
      ).toMatchObject({ attachmentKey: "RGREARL8" });
    }),
);

it("reports each file several attachments name, with the one it kept and the ones it dropped", () => {
  const path = `${VAULT_DIR}/attachments/rougier-2014.pdf`;
  const { index, collisions } = buildPathIndex(
    [
      linkedAttachment({
        itemID: 30,
        key: "RGRGRUP9",
        groupID: 4200309,
        parentIndexedKey: "RUGIERG9g4200309",
        path,
      }),
      linkedAttachment({
        itemID: 47,
        key: "RGRPDF24",
        parentIndexedKey: "RUGIER24",
        path,
      }),
      linkedAttachment({
        itemID: 40,
        key: "RGREARL8",
        parentIndexedKey: "RUGIERE8",
        path,
      }),
    ],
    { dataDir: DATA_DIR, baseAttachmentPath: null, platform: "linux" },
  );

  expect(collisions).toEqual([
    {
      pathKey: path,
      chosen: "RGREARL8",
      discarded: ["RGRPDF24", "RGRGRUP9g4200309"],
    },
  ]);
  expect(index.get(path)).toEqual({
    kind: "resolved",
    serverID: null,
    attachmentKey: "RGREARL8",
    itemKey: "RUGIERE8",
    openable: true,
  });
});

it("reports no collision when every attachment names its own file", () => {
  const { collisions } = buildPathIndex(
    [
      linkedAttachment({
        itemID: 47,
        key: "RGRPDF24",
        parentIndexedKey: "RUGIER24",
        path: `${VAULT_DIR}/attachments/rougier-2014.pdf`,
      }),
      linkedAttachment({
        itemID: 23,
        key: "PDFLINKD",
        parentIndexedKey: "SAKIMA22",
        path: `${LINKED_FILES_DIR}/sakimas-song.pdf`,
      }),
    ],
    { dataDir: DATA_DIR, baseAttachmentPath: null, platform: "linux" },
  );

  expect(collisions).toEqual([]);
});

it.effect(
  "answers pending, and keeps no index, while the database cannot be read",
  () =>
    Effect.gen(function* () {
      const { service: resolver, reads } = yield* setup({
        seeds: [null, null, FIXTURE_ROWS],
        prime: false,
      });
      const path = `${VAULT_DIR}/attachments/rougier-2014.pdf`;

      expect(yield* resolver.resolve(path)).toEqual({ kind: "pending" });
      yield* Stream.runHead(
        reads.changes.pipe(Stream.filter(({ state }) => state === "degraded")),
      );
      expect(yield* resolver.resolve(path)).toEqual({ kind: "pending" });
      expect(yield* resolver.lookup("RGRPDF24")).toEqual({ kind: "pending" });

      const announced = yield* nextAnnouncement(resolver);
      yield* reads.refresh;
      yield* Fiber.join(announced);

      expect(yield* resolver.resolve(path)).toEqual(ROUGIER);
    }),
);

it.effect(
  "settles indexed once the first index lands, and builds nothing itself",
  () =>
    Effect.gen(function* () {
      const { service: resolver, queries } = yield* setup({ prime: false });

      const indexed = yield* resolver.indexed.pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      expect(queries.client.isFetching()).toBe(0);

      yield* resolver.warm;
      expect(queries.client.isFetching()).toBe(1);
      yield* Fiber.join(indexed);
      expect(yield* resolver.lookup("RGRPDF24")).toMatchObject({
        kind: "resolved",
      });
    }),
);

it.effect("builds the first index when warmed, before any lookup", () =>
  Effect.gen(function* () {
    const { service: resolver } = yield* setup({ prime: false });

    const announced = yield* nextAnnouncement(resolver);
    yield* resolver.warm;
    yield* Fiber.join(announced);

    expect(yield* resolver.lookup("RGRPDF24")).toEqual({
      ...ROUGIER,
      absolutePath: `${VAULT_DIR}/attachments/rougier-2014.pdf`,
    });
  }),
);

it.effect("announces the first index to a caller that was told pending", () =>
  Effect.gen(function* () {
    const { service: resolver } = yield* setup({ prime: false });
    const path = `${VAULT_DIR}/attachments/rougier-2014.pdf`;
    const announced = yield* resolver.resolutionsChanged.pipe(
      Stream.mapEffect(() => resolver.resolve(path)),
      Stream.runHead,
      Effect.forkScoped({ startImmediately: true }),
    );

    expect(yield* resolver.resolve(path)).toEqual({ kind: "pending" });

    expect(yield* Fiber.join(announced)).toEqual(Option.some(ROUGIER));
  }),
);

it.effect(
  "rebuilds after the database changed, answering from the previous index meanwhile",
  () =>
    Effect.gen(function* () {
      const path = `${LINKED_FILES_DIR}/ioannidis-2005.pdf`;
      const {
        service: resolver,
        reads,
        gate,
      } = yield* setup({
        seeds: [
          FIXTURE_ROWS,
          `${
            FIXTURE_ROWS
          }update itemAttachments set path = '${path}' where itemID = 29;`,
        ],
      });

      expect(yield* resolver.resolve(path)).toEqual({ kind: "unresolved" });

      const held = gate();
      const announced = yield* nextAnnouncement(resolver);
      yield* reads.refresh;
      yield* Effect.promise(() => held.waiting);

      expect(yield* resolver.resolve(path)).toEqual({ kind: "unresolved" });
      held.release();
      yield* Fiber.join(announced);

      expect(yield* resolver.resolve(path)).toEqual({
        kind: "resolved",
        serverID: null,
        attachmentKey: "IANPDF25",
        itemKey: "IANNP5A2",
        openable: true,
      });
    }),
);

it.effect(
  "keeps the previous index when a rebuild fails, and asks again after the failure cooldown",
  () =>
    Effect.gen(function* () {
      const path = `${LINKED_FILES_DIR}/ioannidis-2005.pdf`;
      const f = yield* setup({
        seeds: [
          FIXTURE_ROWS,
          `${
            FIXTURE_ROWS
          }update itemAttachments set path = '${path}' where itemID = 29;`,
        ],
      });

      f.failReads(true);
      const failed = yield* Stream.runHead(
        f.queries.changes.pipe(
          Stream.filter(({ held }) => held?.status === "failed"),
        ),
      ).pipe(Effect.forkScoped({ startImmediately: true }));
      yield* f.reads.refresh;
      yield* Fiber.join(failed);
      expect(f.failures).toBe(1);

      expect(yield* f.service.resolve(path)).toEqual({ kind: "unresolved" });
      expect(f.failures).toBe(1);

      f.failReads(false);
      yield* TestClock.adjust("10 seconds");
      const announced = yield* nextAnnouncement(f.service);
      expect(yield* f.service.resolve(path)).toEqual({ kind: "unresolved" });
      yield* Fiber.join(announced);

      expect(yield* f.service.resolve(path)).toMatchObject({
        kind: "resolved",
        serverID: null,
        attachmentKey: "IANPDF25",
      });
    }),
);

it.effect("rebuilds after the resolved Zotero paths changed", () =>
  Effect.gen(function* () {
    const { service: resolver, moveDataDir } = yield* setup();
    const path = "/moved-zotero/storage/PDFSTR22/sakimas-song.pdf";

    expect(yield* resolver.resolve(path)).toEqual({ kind: "unresolved" });

    const announced = yield* nextAnnouncement(resolver);
    yield* moveDataDir("/moved-zotero");
    yield* Fiber.join(announced);

    expect(yield* resolver.resolve(path)).toEqual({
      kind: "resolved",
      serverID: null,
      attachmentKey: "PDFSTR22",
      itemKey: "SAKIMA22",
      openable: true,
    });
  }),
);

it("answers pending, and builds nothing, once its runtime is released", async () => {
  const { service, bridge, close } = await openResolver({ rows: FIXTURE_ROWS });
  await close();

  expect(
    bridge.runSync(
      service.resolve(`${VAULT_DIR}/attachments/rougier-2014.pdf`),
    ),
  ).toEqual({ kind: "pending" });
  expect(bridge.runSync(service.lookup("RGRPDF24"))).toEqual({
    kind: "pending",
  });
  expect(() => bridge.runSync(service.warm)).not.toThrow();
});

const ADDED = toInstant(DateTime.makeUnsafe("2025-02-04T12:00:00Z"));

function linkedAttachment({
  itemID,
  key,
  parentIndexedKey,
  path,
  groupID = null,
}: {
  itemID: number;
  key: string;
  parentIndexedKey: string | null;
  path: string;
  groupID?: number | null;
}): AttachmentWithParentKey {
  return {
    itemID,
    libraryID: groupID === null ? 1 : 2,
    groupID,
    key,
    indexedKey: groupID === null ? key : `${key}g${groupID}`,
    parentIndexedKey,
    parentItemID: itemID - 1,
    path,
    contentType: "application/pdf",
    linkMode: 2,
    dateAdded: ADDED,
    dateModified: ADDED,
  };
}

const fileAt = (path: string, File: typeof TFile = TFile): TFile =>
  Object.assign(new File(), { path, extension: "pdf" });

it.effect("resolves a vault file through the vault's path of the file", () =>
  Effect.gen(function* () {
    const { service: resolver } = yield* setup();

    expect(
      yield* resolver.resolveFile(fileAt("attachments/rougier-2014.pdf")),
    ).toEqual(ROUGIER);
  }),
);

it.effect(
  "resolves a Zotero storage file outside the vault by its real path",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup();
      const file = fileAt(
        `file:${DATA_DIR}/storage/PDFSTR22/sakimas-song.pdf`,
        TExternalFile,
      );

      expect(yield* resolver.resolveFile(file)).toMatchObject({
        kind: "resolved",
        attachmentKey: "PDFSTR22",
      });
    }),
);

it.effect(
  "resolves a vault file that two Attachments share to the Attachment the open named",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup({ rows: SHARED_FILE_ROWS });
      const file = fileAt("attachments/rougier-2014.pdf");

      expect(
        yield* resolver.resolveFile(file, { attachmentKey: "RGRPDF24" }),
      ).toEqual(ROUGIER);
      expect(yield* resolver.resolveFile(file)).toMatchObject({
        attachmentKey: "RGREARL8",
      });
    }),
);

it.effect(
  "answers pending at once before the first index, and waits for it when asked to",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup({ prime: false });
      const file = fileAt("attachments/rougier-2014.pdf");

      expect(yield* resolver.resolveFile(file)).toEqual({ kind: "pending" });
      expect(yield* resolver.resolveFile(file, { wait: "2 seconds" })).toEqual(
        ROUGIER,
      );
    }),
);

it.effect(
  "answers pending when the wait ends while the database cannot be read",
  () =>
    Effect.gen(function* () {
      const { service: resolver } = yield* setup({
        seeds: [null, null, FIXTURE_ROWS],
        prime: false,
      });
      const waiting = yield* resolver
        .resolveFile(fileAt("attachments/rougier-2014.pdf"), {
          wait: "2 seconds",
        })
        .pipe(Effect.forkScoped({ startImmediately: true }));

      yield* TestClock.adjust("2 seconds");

      expect(yield* Fiber.join(waiting)).toEqual({ kind: "pending" });
    }),
);

function setup(options: ResolverHarnessOptions = {}) {
  return resolverFixture({ rows: FIXTURE_ROWS, ...options });
}
