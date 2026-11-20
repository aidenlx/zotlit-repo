import type { ReaderDocument } from "#/core/document/document.ts";
import type { ReaderHost } from "#/core/host.ts";
import type { PageTheme } from "#/core/theme/theme.ts";
import type {
  ContextTarget,
  ReaderCommand,
  ReaderIntent,
  ReaderState,
  SurfaceKind,
} from "#/core/types.ts";
import type * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

export interface OutlineNode {
  readonly title: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly dest: string | readonly unknown[] | null;
  readonly url: string | null;
  readonly action: string | null;
  readonly items: readonly OutlineNode[];
}

export interface ChromeActions {
  set(intent: ReaderIntent): void;
  command(command: ReaderCommand): boolean;
  goToPage(pageIndex: number): void;
  goToDestination(dest: string | readonly unknown[]): void;
  openUrl(url: string): void;
  runAction(action: string): void;
  revealOutline(): void;
  pageOf(dest: string | readonly unknown[]): Promise<number | null>;
  sectionSubpath(dest: string | readonly unknown[]): Promise<string | null>;
  renderThumbnail(
    pageIndex: number,
    canvas: HTMLCanvasElement,
    options: { readonly signal: AbortSignal; readonly theme: PageTheme },
  ): Promise<void>;
  submitPassword(password: string): void;
  cancelPassword(): void;
  showMenu(target: ContextTarget, at: MouseEvent | HTMLElement): void;
}

export interface ChromeModel {
  readonly host: ReaderHost;
  readonly kind: SurfaceKind;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly state: Atom.Atom<ReaderState>;
  readonly document: Atom.Atom<ReaderDocument | null>;
  readonly outline: Atom.Atom<readonly OutlineNode[] | null>;
  readonly labels: Atom.Atom<readonly string[] | null>;
  readonly reveal: Atom.Writable<boolean>;
  readonly pageTheme: Atom.Atom<PageTheme>;
  readonly actions: ChromeActions;
  readonly findInput: { current: HTMLInputElement | null };
}

export function pageText(
  labels: readonly string[] | null,
  showPageLabels: boolean,
  pageIndex: number,
): string {
  return (
    (showPageLabels ? labels?.[pageIndex] : undefined) ?? String(pageIndex + 1)
  );
}

export const ChromeContext = createContext<ChromeModel | null>(null);

export function useChrome(): ChromeModel {
  const model = useContext(ChromeContext);
  if (!model) throw new Error("The reader chrome has no model");
  return model;
}
