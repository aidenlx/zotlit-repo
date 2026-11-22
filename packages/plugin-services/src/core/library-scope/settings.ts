import type { SliceSettings } from "#core/settings/slice.ts";

import {
  DEFAULT_LIBRARY_SCOPE,
  libraryScopeSchema,
} from "@zotlit/zotero-reads/contract/library-scope.ts";

import { settingsSlice } from "#core/settings/slice.ts";

export const libraryScopeSettings = settingsSlice(
  {
    "zotero.library-scope": libraryScopeSchema,
  },
  { "zotero.library-scope": DEFAULT_LIBRARY_SCOPE },
);

type LibraryScopeSettings = SliceSettings<typeof libraryScopeSettings>;

declare module "#core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends LibraryScopeSettings {}
}
