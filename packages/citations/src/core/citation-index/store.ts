import { openDB } from "idb";
import type { DBSchema } from "idb";

import type { NoteScanRecord } from "./scan-note.ts";

export const SCANNER_REVISION = 1;

export interface FileScan extends Pick<
  NoteScanRecord,
  | "citekeys"
  | "wikilinks"
  | "malformedWikilinks"
  | "annotations"
  | "malformedAnnotationCitations"
> {
  mtime: number;
  size: number;
  scannerRevision: number;
}

export interface CitekeyRecord extends FileScan {
  path: string;
}

export interface CitekeyStore extends Disposable {
  load(): Promise<CitekeyRecord[]>;
  put(record: CitekeyRecord): Promise<void>;
  drop(path: string): Promise<void>;
  clear(): Promise<void>;
}

const SCANS = "scans";

const SCHEMA_VERSION = 2;

interface CitationIndexSchema extends DBSchema {
  scans: { key: string; value: CitekeyRecord };
}

export async function openCitekeyStore(appId: string): Promise<CitekeyStore> {
  const db = await openDB<CitationIndexSchema>(
    `${appId}-zotlit-citation-index`,
    SCHEMA_VERSION,
    {
      upgrade(database) {
        if (database.objectStoreNames.contains(SCANS)) {
          database.deleteObjectStore(SCANS);
        }
        database.createObjectStore(SCANS, { keyPath: "path" });
      },
    },
  );
  return {
    load: () => db.getAll(SCANS),
    put: async (record) => {
      await db.put(SCANS, record);
    },
    drop: (path) => db.delete(SCANS, path),
    clear: () => db.clear(SCANS),
    [Symbol.dispose]: () => db.close(),
  };
}
