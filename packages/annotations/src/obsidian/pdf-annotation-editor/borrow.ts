import type {
  BorrowedExcerptDocument,
  ExcerptCropPage,
} from "#obsidian/excerpt-image/reader-borrow.ts";

import { getLogger } from "@zotlit/plugin-kernel/log.ts";
import type { ReaderDocument } from "@zotlit/reader-api";

const logger = getLogger("pdf-annotation-editor");

export function borrowReaderDocument(
  document_: ReaderDocument | null,
  path: string | null,
): BorrowedExcerptDocument | null {
  if (!document_ || !path || !document_.current()) return null;
  const answered = <A>(read: Promise<A | null>, what: string) =>
    read.catch((error: unknown) => {
      logger.debug("The reader's document did not answer a borrow", {
        what,
        error,
      });
      return null;
    });
  return {
    path,
    document: document_.proxy,
    current: () => document_.current(),
    bytes: () => answered(document_.bytes(), "bytes"),
    page: (pageIndex) =>
      answered(
        document_.page(pageIndex) as Promise<ExcerptCropPage | null>,
        "page",
      ),
  };
}
