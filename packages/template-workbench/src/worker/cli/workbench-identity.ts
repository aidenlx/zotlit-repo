import type { SourceIdentity } from "@zotlit/zotero-reads/contract/source-identity.ts";

export interface WorkbenchIdentity {
  vault: {
    name: string;
    path: string;
  };
  source: SourceIdentity | null;
}
