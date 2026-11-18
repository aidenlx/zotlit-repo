// The menus the plugin raises itself (`ZotLitMenuEvents`). The private API
// that needs no plugin type is declared in the Obsidian kit's typings; the
// Obsidian kit, the annotation, citation and notes features declare their own
// menus and workspace events.
import "obsidian";

declare module "@zotlit/obsidian-kit/menu-events.ts" {
  interface ZotLitMenuEvents {
    /** A row's menu in the Library View: the Item the row lists. */
    "zotlit:item-menu": {
      source: "library-view";
      /** The Item's Indexed Key. */
      indexedKey: string;
    };
  }
}
