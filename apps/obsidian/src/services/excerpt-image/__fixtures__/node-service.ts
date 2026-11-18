// Node tests use the production platform filesystem.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";

import type { ExcerptDeps } from "@/services/excerpt-image/service.ts";
import { ExcerptImageFixture } from "./service.ts";

export class NodeExcerptImageFixture extends ExcerptImageFixture {
  constructor(deps: ExcerptDeps = {}, fs = NodeFileSystem.layer) {
    super(deps, fs);
  }
}
