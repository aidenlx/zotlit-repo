import type { Events } from "obsidian";

import { connectReader, READER_API } from "@zotlit/reader-api";

import type { ReaderSource } from "./service.ts";

export const readerHandshake =
  (app: { readonly workspace: Events }, client: string): ReaderSource =>
  (handlers) =>
    connectReader(app.workspace, { client, ...READER_API }, handlers);
