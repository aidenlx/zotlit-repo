import type {
  Annotation,
  Attachment,
  AnnotationFileLinkAnchor,
  FallibleTemplateLink,
  Item,
  NoteResolvers,
  TemplateFilenameItemData,
  TemplateLink,
  TemplateNoteLink,
} from "@zotlit/db";
import { zoteroNoteLink } from "@zotlit/db";
import { markInertPlaceholder } from "@zotlit/db/template-data";

export type ExcerptImageContext =
  | { kind: "file-url" }
  | { kind: "not-imported" }
  | { kind: "vault"; folderPath: string };

export interface InertNoteFile {
  readonly path: string;
}

export interface InertNoteIndex<File extends InertNoteFile = InertNoteFile> {
  getNotesByItemKey(indexedKey: string): readonly File[];
  getImportedNoteByNoteKey(indexedKey: string): readonly File[];
}

export interface GenerateMarkdownLinkOptions<
  File extends InertNoteFile = InertNoteFile,
> {
  file: File;
  sourcePath: string;
  subpath?: string;
  alias?: string;
}

export function findExistingLitNote<File extends InertNoteFile>(
  noteIndex: Pick<InertNoteIndex<File>, "getNotesByItemKey">,
  item: { indexedKey: string },
): File | null {
  return noteIndex.getNotesByItemKey(item.indexedKey)[0] ?? null;
}

export interface InertNoteResolverDeps<
  File extends InertNoteFile = InertNoteFile,
> {
  noteIndex: InertNoteIndex<File>;
  getFileByPath: (path: string) => File | null;
  generateMarkdownLink: (options: GenerateMarkdownLinkOptions<File>) => string;
  sourcePath: string;
  excerptImages: ExcerptImageContext;
  notImportedReason: () => string;
  attachmentAbsPath: (attachment: Attachment) => string | null;
  attachmentFileLink: (
    attachment: Attachment,
    anchor?: AnnotationFileLinkAnchor,
  ) => FallibleTemplateLink;
  annotationCachePath: (annotation: Annotation) => string | null;
  commentToMarkdown: (html: string) => string;
  authorsShort: (item: Item) => string;
  fileUrlLink: (absPath: string, defaultAlias: string) => TemplateLink;
  normalizeVaultPath: (path: string) => string;
}

export function buildInertNoteResolvers<File extends InertNoteFile>(
  deps: InertNoteResolverDeps<File>,
): NoteResolvers {
  const resolveExistingNote = (
    item: Pick<TemplateFilenameItemData, "indexedKey" | "citationKey">,
  ): File | null =>
    findExistingLitNote(deps.noteIndex, { indexedKey: item.indexedKey });

  const notImportedPlaceholder = () =>
    markInertPlaceholder(() => "", deps.notImportedReason());

  return {
    annotation: {
      filePath: deps.attachmentAbsPath,
      fileLink: deps.attachmentFileLink,
      commentToMarkdown: deps.commentToMarkdown,
      annotationImageLink: (annotation: Annotation) => {
        const cachePath = deps.annotationCachePath(annotation);
        if (cachePath == null) return null;

        const vaultName = `${annotation.key}.png`;
        switch (deps.excerptImages.kind) {
          case "file-url":
            return deps.fileUrlLink(cachePath, vaultName);
          case "not-imported":
            return notImportedPlaceholder();
          case "vault": {
            const vaultPath = deps.normalizeVaultPath(
              joinFolderPath(deps.excerptImages.folderPath, vaultName),
            );
            const existing = deps.getFileByPath(vaultPath);
            return existing
              ? (alias, subpath) =>
                  deps.generateMarkdownLink({
                    file: existing,
                    sourcePath: deps.sourcePath,
                    subpath,
                    alias,
                  })
              : notImportedPlaceholder();
          }
        }
      },
      authorsShort: deps.authorsShort,
    },
    item: {
      authorsShort: deps.authorsShort,
      notePath: (item) => resolveExistingNote(item)?.path ?? null,
      noteLink: (item, alias, subpath) => {
        const file = resolveExistingNote(item);
        return file
          ? deps.generateMarkdownLink({ file, sourcePath: "", subpath, alias })
          : null;
      },
    },
    resolveChildNote: (note): TemplateNoteLink => {
      const existing = deps.noteIndex.getImportedNoteByNoteKey(
        note.indexedKey,
      )[0];
      return {
        key: note.key,
        indexedKey: note.indexedKey,
        title: note.title,
        noteLink: existing
          ? (alias, subpath) =>
              deps.generateMarkdownLink({
                file: existing,
                sourcePath: deps.sourcePath,
                subpath,
                alias: alias ?? note.title ?? undefined,
              })
          : (alias) => zoteroNoteLink(note, alias),
      };
    },
  };
}

function joinFolderPath(folder: string, name: string): string {
  return folder === "/" ? name : `${folder}/${name}`;
}
