import type { App, ExtendedHotkey, TFile, View } from "obsidian";

export interface RenameListener {
  fn: (file: TFile, oldPath: string) => unknown;
}
export type PageApp = App & {
  commands: App["commands"] & {
    commands: Record<string, import("obsidian").Command>;
  };
  workspace: App["workspace"] & {
    editorSuggest: {
      suggests: (import("obsidian").EditorSuggest<never> & {
        isOpen: boolean;
      })[];
    };
    protocolHandler: {
      handlers: Map<
        string,
        (params: Record<string, string | undefined>) => void
      >;
    };
    floatingSplit: { children: { win: Window }[] };
    isAttached(leaf: import("obsidian").WorkspaceLeaf): boolean;
  };
  cli: { handlers: Map<string, unknown> };
  changeTheme(theme: "obsidian" | "moonstone" | "system"): void;
  viewRegistry: {
    viewByType: Record<string, unknown>;
    typeByExtension: Record<string, string>;
  };
  plugins: App["plugins"] & {
    plugins: App["plugins"]["plugins"] & {
      zotlit?: import("obsidian").Plugin & {
        _loaded: boolean;
        services: unknown;
      };
      "zotlit-reader"?: import("obsidian").Plugin & {
        _loaded: boolean;
        services: unknown;
        api?: unknown;
      };
    };
    manifests: Record<string, import("obsidian").PluginManifest>;
    loadManifests(): Promise<void>;
    loadManifest(dir: string): Promise<void>;
    didChange(): void;
    disablePlugin(id: string): Promise<void>;
    enablePlugin(id: string): Promise<void>;
  };
  hotkeyManager: App["hotkeyManager"] & {
    setHotkeys(id: string, hotkeys: ExtendedHotkey[]): void;
    removeHotkeys(id: string): void;
    save(): Promise<void>;
  };
  vault: App["vault"] & {
    _: { rename?: RenameListener[] };
    readPluginData(dir: string): Promise<unknown>;
    setConfig(key: "trashOption", value: "local" | "system" | "none"): void;
    getConfig(key: "nativeMenus" | "settingsPopoutWindow"): boolean;
    getConfig(key: "theme"): "obsidian" | "moonstone" | "system";
    setConfig(
      key: "nativeMenus" | "settingsPopoutWindow",
      value: boolean,
    ): void;
  };
};

export interface EmptyView extends View {
  actionListEl: HTMLElement;
}

declare global {
  interface Window {
    __ztRestoreBackgroundThrottling?: () => void;
  }
  namespace NodeJS {
    interface Process {
      _getActiveHandles(): object[];
    }
  }
}
