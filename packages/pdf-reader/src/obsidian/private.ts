import type { App, Component, TFile } from "obsidian";

export interface EmbedContext {
  readonly app: App;
  readonly containerEl: HTMLElement;
  readonly linktext: string;
  readonly sourcePath: string;
  readonly depth: number;
  readonly displayMode?: boolean;
}

export interface EmbedComponent extends Component {
  loadFile(): Promise<void>;
}

export type EmbedCreator = (
  context: EmbedContext,
  file: TFile,
  subpath: string,
) => EmbedComponent | null;

export interface ViewRegistry {
  readonly typeByExtension: Readonly<Record<string, string>>;
  registerExtensions(extensions: readonly string[], viewType: string): void;
  unregisterExtensions(extensions: readonly string[]): void;
}

export interface EmbedRegistry {
  readonly embedByExtension: Readonly<Record<string, EmbedCreator>>;
  registerExtension(extension: string, creator: EmbedCreator): void;
  unregisterExtension(extension: string): void;
}

export interface ElectronWindow extends Window {
  readonly electron?: {
    readonly remote: {
      getCurrentWebContents(): { showDefinitionForSelection(): void };
    };
  };
}
