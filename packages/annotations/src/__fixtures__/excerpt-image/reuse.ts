import { NodeExcerptImageFixture as ExcerptImageService } from "./node-service.ts";
import { vi } from "vitest";

import { bluePng } from "./png.ts";
import { PNG_FORMAT } from "#core/excerpt-image/format.ts";
import type { ExcerptOutcomeScope } from "#obsidian/excerpt-image/outcome-scope.ts";
import type {
  ExcerptOutcome,
  ExcerptRequest,
} from "#obsidian/excerpt-image/service.ts";

const reusedRequest: ExcerptRequest = {
  annotation: {
    key: "REUSE001",
    parentKey: "ATTACH01",
    type: "image",
    color: "#ff0000",
    comment: null,
    text: null,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: null,
    lock: null,
    position: { kind: "pdf-rects", pageIndex: 0, rects: [[10, 20, 80, 90]] },
  },
  source: {
    kind: "zotero-db",
    database: { userID: 1, localUserKey: "LOCAL", serverID: "SERVER" },
    libraryID: 1,
    libraryRevision: 1,
  },
  sourceScope: "/zotero",
  libraryID: 1,
  attachmentKey: "ATTACH01",
  pdfPath: "/paper.pdf",
  zoteroPngPath: null,
};

export interface ExcerptReuseProbe extends AsyncDisposable {
  renders(): number;
  resolve(outcomes: ExcerptOutcomeScope | undefined): Promise<ExcerptOutcome>;
}

export function excerptReuseProbe(): ExcerptReuseProbe {
  const render = vi.fn(async () => ({ bytes: bluePng, format: PNG_FORMAT }));
  const service = new ExcerptImageService({ render });
  return {
    renders: () => render.mock.calls.length,
    resolve: async (outcomes) => {
      await using operation = service.operation({ outcomes });
      return await operation.resolve(reusedRequest);
    },
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}
