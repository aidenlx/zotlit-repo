import { Layer } from "effect";

import { layerUnreadViewServices as layerUnreadQueryViewServices } from "@zotlit/query-views/__fixtures__/view-atoms.ts";

import { Release } from "#obsidian/release/service.ts";

export const layerUnreadViewServices = Layer.mergeAll(
  layerUnreadQueryViewServices,
  Layer.mock(Release, { version: "" }),
);
