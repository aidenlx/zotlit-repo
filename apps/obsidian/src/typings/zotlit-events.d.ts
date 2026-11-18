// The workspace events ZotLit raises that carry the plugin's own types, and the
// menus the plugin raises itself (`ZotLitMenuEvents`). The private API that
// needs no plugin type is declared in the Obsidian kit's typings; the
// annotation feature declares its own menus.
import "obsidian";

declare module "obsidian" {
  interface Workspace {
    on(
      name: "zotlit:switch-profile",
      callback: (request: { path: string }) => void,
      ctx?: any,
    ): EventRef;

    /** `request.document` is the vault path of the Template Document holding
     *  the call that refused, and `request.problem` the failure to explain on
     *  arrival; the Default Profile stands in when there is no document. */
    on(
      name: "zotlit:open-template-workbench",
      callback: (
        request: import("@/services/template/workbench-recovery.ts").TemplateWorkbenchRequest,
      ) => void,
      ctx?: any,
    ): EventRef;
  }
}

declare module "@zotlit/obsidian-kit/menu-events.ts" {
  interface ZotLitMenuEvents {
    /** The picker over the works one Rendered Citation names, when it names several. */
    "zotlit:cited-works-menu": {
      works: readonly import("@/services/citekey-navigation/intent.ts").CitedWork[];
    };
    /** A Cited Work Node's menu in the graph: the citekey the node stands for. */
    "zotlit:graph-cited-work-menu": {
      citekey: string;
      /** What the citekey names; `null` while the resolution snapshot is cold. */
      resolution:
        | import("@zotlit/zotero-reads/contract/citation-lookup.ts").CitekeyResolution
        | null;
    };
    /** A row's menu in the Library View: the Item the row lists. */
    "zotlit:item-menu": {
      source: "library-view";
      /** The Item's Indexed Key. */
      indexedKey: string;
    };
  }
}
