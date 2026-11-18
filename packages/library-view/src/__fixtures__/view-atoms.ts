// The view services a test host of this package leaves unread, so its registry
// context is whole. Each member dies when called. Only this package's tests
// read it: a host's program registers more view services.
import { Layer } from "effect";

import { layerUnreadViewServices as layerUnreadQueryViewServices } from "@zotlit/query-views/__fixtures__/view-atoms.ts";

import { Release } from "#obsidian/release/service.ts";

/**
 * Every view service outside the Obsidian host tags, as an empty mock. Merge
 * it first: a service the test reads, merged after it, takes its place.
 */
export const layerUnreadViewServices = Layer.mergeAll(
  layerUnreadQueryViewServices,
  Layer.mock(Release, { version: "" }),
);
