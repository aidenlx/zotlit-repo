// Node tests use the production platform filesystem.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import type { Layer } from "effect";

import type { ExcerptDeps } from "#desktop/excerpt-image/layer.ts";
import { ExcerptImageFixture } from "./service.ts";
import type { PdfEngine } from "#obsidian/pdf-engine/service.ts";

export class NodeExcerptImageFixture extends ExcerptImageFixture {
  constructor(deps: ExcerptDeps = {}, fs = NodeFileSystem.layer, engine?: Layer.Layer<PdfEngine>) {
    super(deps, fs, engine);
  }
}
