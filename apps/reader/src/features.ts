import { reader } from "@zotlit/reader-feature/obsidian/feature.ts";

import { readerBase } from "./base.ts";

export const features = [readerBase, reader] as const;
