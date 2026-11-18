// Reader sessions observed by the Annotation View through its registry.
import { Effect, Stream } from "effect";

import { held } from "@zotlit/obsidian-kit/view-atoms.ts";

import { PdfAnnotationEditor } from "./service.ts";

/** The live sessions, refreshed when a late PDF binding becomes available. */
export const pdfSessionsAtom = held(
  Stream.unwrap(Effect.map(PdfAnnotationEditor, (editor) => editor.sessions)),
  new Map(),
);
