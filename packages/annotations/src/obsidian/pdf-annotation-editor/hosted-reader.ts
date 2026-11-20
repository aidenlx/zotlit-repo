import type { PdfReader } from "@zotlit/reader-api";

export type HostedReader = Pick<
  PdfReader,
  | "root"
  | "container"
  | "state"
  | "document"
  | "pageAt"
  | "renderedPages"
  | "navigate"
  | "slot"
  | "focus"
  | "on"
>;
