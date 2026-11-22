import { FLUENT_FILE_NAME } from "@/constant.ts";
import { logger as appLogger } from "@/lib/logger.ts";
import type { FluentMessageId, FluentMessages } from "@/types/fluent.ts";

const FTL_FILES = [FLUENT_FILE_NAME];

export const l10n = new Localization(FTL_FILES);

type InputFreeMembers<I extends FluentMessageId> = I extends FluentMessageId
  ? [FluentMessages[I]] extends [never]
    ? true
    : never
  : never;

export type FluentMessageArgs<I extends FluentMessageId> = [
  FluentMessages[I],
] extends [never]
  ? []
  : [InputFreeMembers<I>] extends [never]
    ? [args: FluentMessages[I]]
    : [args?: FluentMessages[I]];

export function formatValue<I extends FluentMessageId>(
  id: I,
  ...[args]: FluentMessageArgs<I>
): Promise<string | null> {
  return l10n.formatValue(id, args);
}

export function l10nArgs<I extends FluentMessageId>(
  id: I,
  args: FluentMessages[I],
): string {
  void id;
  return JSON.stringify(args);
}

const fluentLogger = appLogger.getChild("l10n");

export async function requireMessage<I extends FluentMessageId>(
  id: I,
  ...args: FluentMessageArgs<I>
): Promise<string> {
  const message = await formatValue(id, ...args);
  if (message === null) {
    fluentLogger.error("missing FTL message", { id });
    throw new Error(`missing FTL message: ${id}`);
  }
  return message;
}

export function attachFluentToWindow(win: Window): void {
  for (const path of FTL_FILES) {
    win.MozXULElement.insertFTLIfNeeded(path);
  }
  fluentLogger.debug("attached fluent files to window", {
    paths: FTL_FILES,
    href: win.location.href,
  });
}

type MenuData<C> = _ZoteroTypes.MenuManager.MenuData<C>;
type ValidTarget = _ZoteroTypes.MenuManager.ValidTarget;
type ContextOf<T extends ValidTarget> =
  _ZoteroTypes.MenuManager.TargetToContextMap[T];

type TypedMenuData<C> = Omit<MenuData<C>, "l10nID" | "menus"> & {
  l10nID?: FluentMessageId;
  menus?: TypedMenuData<C>[];
};

export type TypedMenuOptions<T extends ValidTarget> = Omit<
  _ZoteroTypes.MenuManager.MenuOptions<T>,
  "menus"
> & {
  menus: TypedMenuData<ContextOf<T>>[];
};

export function registerMenu<T extends ValidTarget>(
  options: TypedMenuOptions<T>,
): string | false {
  return Zotero.MenuManager.registerMenu(options);
}
