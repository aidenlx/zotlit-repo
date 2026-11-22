import { Layer } from "effect";

import { layerUnreadViewServices as layerUnreadAnnotationViewServices } from "@zotlit/annotations/__fixtures__/view-atoms.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { CitationIndex } from "#obsidian/citation-index/service.ts";
import { CitationParse } from "#obsidian/citation-parse/service.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import { CitekeyEditor } from "#obsidian/citekey-editor/service.ts";
import { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";
import { BibliographyRender } from "#obsidian/pandoc/render-cache.ts";
import { PandocEngine } from "#obsidian/pandoc/service.ts";

export const layerUnreadViewServices = Layer.mergeAll(
  layerUnreadAnnotationViewServices,
  Layer.mock(CitationParse, {}),
  Layer.mock(PandocEngine, {}),
  Layer.mock(BibliographyRender, {}),
  Layer.mock(CitekeyEditor, {}),
  Layer.mock(CitationText, {}),
  Layer.mock(CitationIndex, {}),
  Layer.mock(CitationLookup, {}),
  Layer.mock(
    ProfileStyles,
    stubService<ProfileStyles["Service"]>("ProfileStyles", {}),
  ),
);
