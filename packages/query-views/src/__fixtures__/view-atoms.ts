import { Layer } from "effect";

import { layerUnreadViewServices as layerUnreadNoteViewServices } from "@zotlit/notes/__fixtures__/view-atoms.ts";

import { QueryService } from "#desktop/item-query/service.ts";

export const layerUnreadViewServices = Layer.mergeAll(
  layerUnreadNoteViewServices,
  Layer.mock(QueryService, {}),
);
