import type { ReaderHost } from "@zotlit/pdf-reader";
import { translate } from "@zotlit/plugin-messages/runtime.ts";

export const zotlitReaderT: ReaderHost["t"] = (key, vars) =>
  translate(key, vars);
