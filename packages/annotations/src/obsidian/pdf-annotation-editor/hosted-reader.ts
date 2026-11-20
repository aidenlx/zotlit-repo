import type { PdfReader } from "@zotlit/pdf-reader";

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
