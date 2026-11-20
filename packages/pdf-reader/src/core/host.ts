import type { ReaderStringKey } from "#/generated/strings.ts";

export interface MenuItem {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly section?: "copy" | "link" | "action" | "view" | "system";
  readonly checked?: boolean;
  readonly disabled?: boolean;
  run(): void;
}

export interface LegacyTextRequest {
  readonly password: string | undefined;
  bytes(): Promise<Uint8Array | null>;
}

export interface LegacyText extends Disposable {
  items(pageIndex: number): Promise<readonly string[] | null>;
}

export interface ReaderHost {
  t(
    key: ReaderStringKey,
    vars?: Readonly<Record<string, string | number>>,
  ): string;
  icon(element: HTMLElement, name: string): void;
  menu(at: MouseEvent | HTMLElement, items: readonly MenuItem[]): void;
  copy(text: string): Promise<void>;
  link(subpath: string, alias?: string): string | null;
  openExternal(url: string): void;
  readonly storage: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  lookUp?(text: string): void;
  watchTheme?(onChange: () => void): () => void;
  legacyText?(request: LegacyTextRequest): LegacyText;
  report(
    error: unknown,
    where: { readonly extension?: string; readonly phase: string },
  ): void;
}
