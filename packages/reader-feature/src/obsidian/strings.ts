import type { ReaderHost } from "@zotlit/pdf-reader";
import { translate } from "@zotlit/reader-messages/runtime.ts";

export const readerT: ReaderHost["t"] = (key, vars) => translate(key, vars);
