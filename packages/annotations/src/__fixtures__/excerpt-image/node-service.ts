import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import type { Layer } from "effect";

import type { ExcerptDeps } from "#desktop/excerpt-image/layer.ts";
import { ExcerptImageFixture } from "./service.ts";
import type { ReaderConnection } from "#obsidian/reader-connection/service.ts";

export class NodeExcerptImageFixture extends ExcerptImageFixture {
  constructor(deps: ExcerptDeps = {}, fs = NodeFileSystem.layer, engine?: Layer.Layer<ReaderConnection>) {
    super(deps, fs, engine);
  }
}
