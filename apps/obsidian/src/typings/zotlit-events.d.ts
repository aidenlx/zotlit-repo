// The parts of Obsidian's API that carry ZotLit's own types: the PDF.js the
// host loads, and the workspace events ZotLit raises. The private API that
// needs no ZotLit type is declared in the Obsidian kit's typings.
import "obsidian";

declare module "obsidian" {
  /** Cold-loads the host PDF.js module and configures its worker. Internal. */
  export function loadPdfJs(): Promise<
    import("../services/excerpt-image/renderer.ts").ExcerptPdfJs
  >;
  interface Workspace {
    on(
      name: "zotlit:switch-profile",
      callback: (request: { path: string }) => void,
      ctx?: any,
    ): EventRef;

    /** A menu ZotLit built, raised before it shows so listeners add entries. */
    on<E extends import("@/services/menu-events.ts").ZotLitMenuEvent>(
      name: E,
      callback: (
        menu: Menu,
        info: import("@/services/menu-events.ts").ZotLitMenuEvents[E],
      ) => any,
      ctx?: any,
    ): EventRef;

    /** `request.document` is the vault path of the Template Document holding
     *  the call that refused, and `request.problem` the failure to explain on
     *  arrival; the Default Profile stands in when there is no document. */
    on(
      name: "zotlit:open-template-workbench",
      callback: (
        request: import("@/lib/workbench-recovery.ts").TemplateWorkbenchRequest,
      ) => void,
      ctx?: any,
    ): EventRef;
  }
}
