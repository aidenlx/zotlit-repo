import { shellPlugin } from "@zotlit/plugin-shell/obsidian/plugin.ts";

import { host } from "./host.ts";
import "./main.css";

export default class ZotLitReaderPlugin extends shellPlugin(host) {}
