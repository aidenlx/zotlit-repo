import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  AvailableLibrary,
  LibrarySelector,
} from "@zotlit/zotero-reads/contract/library-scope.ts";

export function libraryLabel(library: AvailableLibrary): string {
  return library.name ?? selectorLabel(library.selector);
}

export function selectorLabel(selector: LibrarySelector): string {
  return selector.type === "personal"
    ? m.settings_library_scope_personal()
    : m.settings_library_scope_group({ groupID: selector.groupID });
}
