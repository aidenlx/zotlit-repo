// The plugin's services that view atoms read, added to the view-atom registry
// of the Obsidian kit (`ViewServiceRegistry`) by declaration merging. A plugin
// package registers its own services (`@zotlit/zotero-reads/client/atoms.ts`,
// the service tags of `@zotlit/plugin-services`, `@zotlit/annotations`,
// `@zotlit/citations` and `@zotlit/notes`). The Query Clients tag lives
// in that package's host-free layer, which names no view atom, so the plugin
// registers it here.

import type { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";

import type { QueryService } from "@/services/item-query/service.ts";
import type { Release } from "@/services/release/service.ts";

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    QueryService: QueryService;
    QueryClients: QueryClients;
    Release: Release;
  }
}
