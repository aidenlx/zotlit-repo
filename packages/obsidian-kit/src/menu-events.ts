// The menus ZotLit builds itself, raised on the workspace the way Obsidian
// raises `file-menu` and `editor-menu`.
//
// ZotLit fills each menu with its own entries, then raises its event; a
// listener — another plugin, or a ZotLit feature — adds entries to the same
// menu before it shows. Each menu registers its sections first, so a listener's
// entry joins the group it names rather than sorting after "Delete".
//
// A listener runs synchronously, as Obsidian builds a menu in one tick; only an
// entry's `onClick` may await.
//
//   app.workspace.on("zotlit:annotation-menu", (menu, { annotations }) => {
//     menu.addItem((item) =>
//       item.setSection("clipboard").setTitle("Copy as …").setIcon("copy"),
//     );
//   });
//
// The feature that raises a menu owns it: it names the menu's sections with
// `menuEvent` and adds what the event hands its listeners to
// `ZotLitMenuEvents` by declaration merging, in the same file.
import type { Menu, Workspace } from "obsidian";

/**
 * What each ZotLit menu event hands its listeners beside the menu. Each
 * feature adds its own menus:
 *
 * ```ts
 * declare module "@zotlit/obsidian-kit/menu-events.ts" {
 *   interface ZotLitMenuEvents {
 *     "zotlit:item-menu": { source: "library-view"; indexedKey: string };
 *   }
 * }
 * ```
 */
// oxlint-disable-next-line typescript/no-empty-object-type -- the features fill it by declaration merging
export interface ZotLitMenuEvents {}

export type ZotLitMenuEvent = keyof ZotLitMenuEvents;

/**
 * One ZotLit menu: its event, and its sections in the order it shows them.
 * `""` is the unnamed section; `danger` holds what cannot be undone.
 */
export interface MenuEvent<E extends ZotLitMenuEvent, S extends string> {
  readonly name: E;
  readonly sections: readonly (S | "")[];
}

/** Names a menu that ZotLit raises, and the sections it registers. */
export function menuEvent<
  E extends ZotLitMenuEvent,
  const S extends readonly string[],
>(name: E, sections: S): MenuEvent<E, S[number]> {
  return { name, sections };
}

/**
 * A menu's sections by name, for the entries ZotLit itself puts in that menu,
 * so an entry and the menu's registered order read one list.
 */
export function menuSections<S extends string>(
  event: MenuEvent<ZotLitMenuEvent, S>,
): { readonly [K in Exclude<S, "">]: K } {
  return Object.fromEntries(
    event.sections
      .filter((section) => section !== "")
      .map((section) => [section, section]),
  ) as { readonly [K in Exclude<S, "">]: K };
}

/**
 * Register the menu's sections on `menu`, then raise its event so listeners
 * add their entries. Call it once ZotLit's own entries are in, and before the
 * menu shows.
 */
export function raiseMenu<E extends ZotLitMenuEvent>(
  menu: Menu,
  {
    workspace,
    event,
    info,
  }: {
    workspace: Pick<Workspace, "trigger">;
    event: MenuEvent<E, string>;
    info: ZotLitMenuEvents[E];
  },
): void {
  menu.addSections(event.sections);
  workspace.trigger(event.name, menu, info);
}
