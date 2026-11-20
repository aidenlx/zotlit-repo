import { shellPlugin } from "@zotlit/plugin-shell/obsidian/plugin.ts";
import type { ReaderApi } from "@zotlit/reader-api";

import { host } from "./host.ts";
import "./main.css";

export default class ZotLitReaderPlugin extends shellPlugin(host) {
  declare readonly api: ReaderApi | undefined;
}
