import { DatabaseSync } from "node:sqlite";

import { annotationAttachment } from "./e2e-run-fixture.ts";
import { run } from "./e2e-run-lifecycle.ts";
import { obRun } from "./obsidian-cli.ts";

const PDF_PATH = annotationAttachment.path!;

export const SHARED = { attachmentKey: "RGRSHRD2", annotationKey: "SHRDANN2" };

function inTransaction(database: DatabaseSync, write: () => void): void {
  database.exec("begin");
  using rollback = new DisposableStack();
  rollback.defer(() => database.exec("rollback"));
  write();
  database.exec("commit");
  rollback.move();
}

export function addSharedFileAttachment(
  databasePath: string,
  annotationKey: string,
): Disposable {
  using database = new DatabaseSync(databasePath);
  const itemIDOf = (key: string) =>
    (
      database.prepare("select itemID from items where key = ?").get(key) as {
        itemID: number;
      }
    ).itemID;
  const copy = (
    table: string,
    itemID: number,
    set: Record<string, string | number>,
  ) => {
    const columns = (
      database.prepare(`pragma table_info(${table})`).all() as {
        name: string;
      }[]
    ).map(({ name }) => name);
    database
      .prepare(
        `insert into ${table} (${columns.join(", ")}) select ${columns.map((name) => (name in set ? "?" : name)).join(", ")} from ${table} where itemID = ?`,
      )
      .run(
        ...columns.filter((name) => name in set).map((name) => set[name]!),
        itemID,
      );
  };
  const attachmentID = Number(
    Object.values(
      database.prepare("select max(itemID) + 1 from items").get()!,
    )[0],
  );
  const annotationID = attachmentID + 1;

  inTransaction(database, () => {
    const source = itemIDOf(annotationAttachment.key);
    copy("items", source, { itemID: attachmentID, key: SHARED.attachmentKey });
    copy("itemAttachments", source, { itemID: attachmentID });
    const annotation = itemIDOf(annotationKey);
    copy("items", annotation, {
      itemID: annotationID,
      key: SHARED.annotationKey,
    });
    copy("itemAnnotations", annotation, {
      itemID: annotationID,
      parentItemID: attachmentID,
    });
  });

  return {
    [Symbol.dispose]() {
      using database = new DatabaseSync(databasePath);
      database.exec("begin");
      for (const table of ["itemAnnotations", "itemAttachments", "items"])
        database
          .prepare(`delete from ${table} where itemID between ? and ?`)
          .run(attachmentID, annotationID);
      database.exec("commit");
    },
  };
}

export async function reindexed(
  kind: "resolved" | "unresolved",
): Promise<string | null> {
  return obRun(
    run.vaultId,
    async ({ app, zotlit, page }, { kind, attachmentKey, pdfPath }) => {
      const { until } = page.annotationLinkTools(() => zotlit.services);
      const s = zotlit.services;
      await s.bridge.runPromise(s.zoteroReads.refresh);
      await until(
        () =>
          s.bridge.runSync(s.attachmentResolver.lookup(attachmentKey)).kind ===
          kind,
        () =>
          `The Attachment index never answered ${kind} for ${attachmentKey}`,
      );
      const adapter = app.vault.adapter as import("obsidian").FileSystemAdapter;
      const resolution = s.bridge.runSync(
        s.attachmentResolver.resolve(adapter.getFullPath(pdfPath)),
      );
      return resolution.kind === "resolved" ? resolution.attachmentKey : null;
    },
    { kind, attachmentKey: SHARED.attachmentKey, pdfPath: PDF_PATH },
    { timeoutMs: 60000 },
  );
}
