import { Effect, Stream } from "effect";

import { held } from "@zotlit/obsidian-kit/view-atoms.ts";

import { PdfAnnotationEditor } from "./service.ts";

export const pdfSessionsAtom = held(
  Stream.unwrap(Effect.map(PdfAnnotationEditor, (editor) => editor.sessions)),
  new Map(),
);
