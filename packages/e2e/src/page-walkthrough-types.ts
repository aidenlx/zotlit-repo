import type {
  Editor,
  EditorPosition,
  FileSystemAdapter,
  MarkdownView,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

import type { SearchHit } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";

import type { ZotLitSettingTab } from "@/setting-tab/index.ts";

import type { PageApp } from "./page-host.ts";

export interface WalkthroughViews {
  markdown: MarkdownView;
  "zotlit-cited-by": import("@zotlit/citations/obsidian/cited-by/view.tsx").CitedByView;
  "zotlit-template-workbench": import("@zotlit/template-workbench/desktop/view/view.tsx").TemplateWorkbenchView;
  "zotlit-template-data-explorer": import("@zotlit/template-workbench/desktop/data-explorer/view.tsx").TemplateDataExplorerView;
}
export type WalkthroughLeaf<K extends keyof WalkthroughViews> = Omit<
  WorkspaceLeaf,
  "view"
> & { view: WalkthroughViews[K] };
export type WalkthroughCitationSuggest =
  PageApp["workspace"]["editorSuggest"]["suggests"][number] & {
    isOpen: boolean;
    showSuggestions(suggestions: SearchHit[]): void;
  };
export interface WalkthroughEditorSuggest {
  trigger(editor: Editor, file: TFile, cursor: EditorPosition): void;
}
export type WalkthroughApp = PageApp & {
  internalPlugins: { plugins: { sync: { enabled: boolean } } };
  plugins: { plugins: { zotlit: { settingTab: ZotLitSettingTab } } };
  workspace: { editorSuggest: WalkthroughEditorSuggest };
  vault: {
    adapter: FileSystemAdapter;
    getConfig(key: "settingsPopoutWindow"): boolean;
    setConfig(key: "settingsPopoutWindow", value: boolean): void;
  };
};
export interface WalkthroughRemote {
  getCurrentWebContents(): {
    debugger: { sendCommand(method: string, params: object): Promise<unknown> };
  };
}
