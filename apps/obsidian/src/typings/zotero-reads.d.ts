// The Item Query adapter's Query Job and answer, named in the ZoteroReads
// contract (`ItemQueryTypes`) by declaration merging.
import type {
  QueryAnswer,
  QueryJob,
} from "@/services/item-query/worker-protocol.ts";

declare module "@zotlit/zotero-reads/contract/item-query.ts" {
  interface ItemQueryTypes {
    job: QueryJob;
    answer: QueryAnswer;
  }
}
