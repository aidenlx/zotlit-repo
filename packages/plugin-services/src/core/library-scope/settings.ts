// The Library Scope key of the plugin settings.
import {
  DEFAULT_LIBRARY_SCOPE,
  libraryScopeSchema,
} from "@zotlit/zotero-reads/contract/library-scope.ts";

import { settingsSlice } from "#core/settings/slice.ts";

export const libraryScopeSettings = settingsSlice(
  {
    /**
     * Libraries used for item search, citation key resolution, and library-wide
     * commands. Strict by design — an out-of-order or empty selection is broken
     * input, not something to normalize; see
     * `@zotlit/zotero-reads/contract/library-scope.ts`.
     */
    "zotero.library-scope": libraryScopeSchema,
  },
  { "zotero.library-scope": DEFAULT_LIBRARY_SCOPE },
);
