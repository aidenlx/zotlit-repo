import type { Menu, Workspace } from "obsidian";

// oxlint-disable-next-line typescript/no-empty-object-type -- the features fill it by declaration merging
export interface ZotLitMenuEvents {}

export type ZotLitMenuEvent = keyof ZotLitMenuEvents;

export interface MenuEvent<E extends ZotLitMenuEvent, S extends string> {
  readonly name: E;
  readonly sections: readonly (S | "")[];
}

export function menuEvent<
  E extends ZotLitMenuEvent,
  const S extends readonly string[],
>(name: E, sections: S): MenuEvent<E, S[number]> {
  return { name, sections };
}

export function menuSections<S extends string>(
  event: MenuEvent<ZotLitMenuEvent, S>,
): { readonly [K in Exclude<S, "">]: K } {
  return Object.fromEntries(
    event.sections
      .filter((section) => section !== "")
      .map((section) => [section, section]),
  ) as { readonly [K in Exclude<S, "">]: K };
}

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
