import type { E2eServices } from "@zotlit/obsidian/e2e";
import type { ReaderApi } from "@zotlit/reader-api";
import type { E2eServices as ReaderServices } from "@zotlit/reader/e2e";

import type { createPageHelpers } from "./page-helpers.ts";
import type { PageApp } from "./page-host.ts";

export interface ObsidianContext {
  app: PageApp;
  zotlit: { services: E2eServices };
  reader: { services: ReaderServices; api: ReaderApi | undefined };
  page: ReturnType<typeof createPageHelpers>;
}

export type JsonCompatible<T> = T extends
  | string
  | number
  | boolean
  | null
  | undefined
  | void
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly unknown[]
      ? { [K in keyof T]: JsonCompatible<T[K]> }
      : T extends object
        ? { [K in keyof T]: JsonCompatible<T[K]> }
        : never;
