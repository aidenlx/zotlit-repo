import type { TAbstractFile, TFile } from "obsidian";

import type { FileManagerSource } from "#obsidian-file-manager.ts";

export class MemoryFileManager implements FileManagerSource {
  readonly frontmatter = new Map<string, Record<string, unknown>>();
  readonly renames: { from: string; to: string }[] = [];
  failNext: Error | undefined = undefined;

  #reject(): Promise<never> | undefined {
    if (this.failNext === undefined) return;
    const cause = this.failNext;
    this.failNext = undefined;
    return Promise.reject(cause);
  }

  async processFrontMatter(
    file: TFile,
    fn: (frontmatter: Record<string, unknown>) => void,
  ): Promise<void> {
    await this.#reject();
    const frontmatter = structuredClone(this.frontmatter.get(file.path) ?? {});
    fn(frontmatter);
    this.frontmatter.set(file.path, frontmatter);
  }

  async renameFile(file: TFile, newPath: string): Promise<void> {
    await this.#reject();
    const from = file.path;
    const frontmatter = this.frontmatter.get(from);
    if (frontmatter) {
      this.frontmatter.delete(from);
      this.frontmatter.set(newPath, frontmatter);
    }
    file.path = newPath;
    this.renames.push({ from, to: newPath });
  }

  generateMarkdownLink(
    ...[file, , subpath = "", alias]: [TFile, string, string?, string?]
  ): string {
    return `[[${file.path}${subpath}${alias ? `|${alias}` : ""}]]`;
  }

  async getAvailablePathForAttachment(filename: string): Promise<string> {
    return filename;
  }

  readonly trashed: TAbstractFile[] = [];

  async trashFile(file: TAbstractFile): Promise<void> {
    await this.#reject();
    this.trashed.push(file);
  }
}
