import type { getDocument } from "@zotlit/pdfjs/lib";

export type { PageViewport } from "@zotlit/pdfjs/lib";
export type PDFDocumentLoadingTask = ReturnType<typeof getDocument>;
export type PDFDocumentProxy = Awaited<PDFDocumentLoadingTask["promise"]>;
export type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy["getPage"]>>;
export type TextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;
export type TextItem = Extract<TextContent["items"][number], { str: string }>;
export type TextChar = NonNullable<TextItem["chars"]>[number];
