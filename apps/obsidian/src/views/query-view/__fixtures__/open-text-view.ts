import { TextFileView } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";

import type { ObsidianHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

class OpenTextView extends TextFileView {
  data = "";

  readonly file: TFile;
  readonly host: ObsidianHost;

  constructor(
    leaf: WorkspaceLeaf,
    file: TFile,
    host: ObsidianHost,
  ) {
    super(leaf);
this.file = file;
this.host = host;

    this.lastSavedData = host.text(file.path) ?? "";
    this.setViewData(this.lastSavedData);
  }

  edit(data: string): void {
    this.setViewData(data);
  }

  override getViewData(): string {
    return this.data;
  }

  override setViewData(data: string): void {
    this.data = data;
  }

  override clear(): void {
    this.data = "";
  }

  override getViewType(): string {
    return "markdown";
  }

  override save(): Promise<void> {
    return this.host.vault.modify(this.file, this.data);
  }
}

export function openTextFileView(
  host: ObsidianHost,
  file: TFile,
): OpenTextView {
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    updateHeader() {},
  });
  Object.defineProperty(leaf, "app", { value: host.app });
  const view = new OpenTextView(leaf, file, host);
  leaf.view = view;
  Object.assign(host.workspace, {
    iterateAllLeaves(callback: (target: WorkspaceLeaf) => void) {
      callback(leaf);
    },
  });
  return view;
}
