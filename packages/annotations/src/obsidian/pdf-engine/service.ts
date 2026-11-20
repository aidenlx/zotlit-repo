import { Context } from "effect";

import type { PdfEngine as ReaderPdfEngine } from "@zotlit/pdf-reader";

export class PdfEngine extends Context.Service<PdfEngine, ReaderPdfEngine>()(
  "zotlit/pdf-engine/PdfEngine",
) {}
