import { createRequire } from "node:module";

const { version } = createRequire(import.meta.url)(
  "@sqlite.org/sqlite-wasm/package.json",
) as { version: string };

export const SQLITE_ENGINE_VERSION = version;
