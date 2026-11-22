import { Context, Effect, Layer } from "effect";

import type { CitationVariant, ContractRoot } from "@zotlit/db";

import { readCitationData, readTemplateData } from "./data.ts";
import type {
  CitationDataLoadResult,
  CitationSelector,
  TemplateDataError,
  TemplateDataLoadResult,
  TemplateDataServices,
} from "./data.ts";

export class TemplateDataReads extends Context.Service<
  TemplateDataReads,
  {
    read(
      indexedKey: string,
      root: ContractRoot,
    ): Effect.Effect<TemplateDataLoadResult, TemplateDataError>;
    readCitation(
      selector: CitationSelector,
      variant: CitationVariant,
    ): Effect.Effect<CitationDataLoadResult, TemplateDataError>;
  }
>()("zotlit/template-workbench/TemplateDataReads") {}

export const layerTemplateDataReads: Layer.Layer<
  TemplateDataReads,
  never,
  TemplateDataServices
> = Layer.effect(
  TemplateDataReads,
  Effect.gen(function* () {
    const context = yield* Effect.context<TemplateDataServices>();
    return {
      read: Effect.fn("TemplateDataReads.read")((indexedKey, root) =>
        readTemplateData(indexedKey, root).pipe(Effect.provideContext(context)),
      ),
      readCitation: Effect.fn("TemplateDataReads.readCitation")(
        (selector, variant) =>
          readCitationData(selector, variant).pipe(
            Effect.provideContext(context),
          ),
      ),
    };
  }),
);

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    TemplateDataReads: TemplateDataReads;
  }
}
