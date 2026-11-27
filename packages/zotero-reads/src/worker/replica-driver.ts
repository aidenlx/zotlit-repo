import type { ZoteroDatabase } from "@zotlit/db";

export interface ReplicaWrites {
  readonly statements: number;
  readonly changes: number;
}

export interface ReplicaHandle {
  readonly db: ZoteroDatabase;
  readonly statements: () => number;
  readonly changes: () => number;
  readonly inTransaction: () => boolean;
  readonly exec: (sql: string) => void;
  readonly commitApply: () => void;
  readonly checkpoint: () => void;
  readonly renew: () => ZoteroDatabase;
  readonly close: () => void;
}

export interface ReplicaDriver {
  readonly open: (file: string) => ReplicaHandle;
  readonly remove: (file: string) => void;
  readonly close: () => void;
}
