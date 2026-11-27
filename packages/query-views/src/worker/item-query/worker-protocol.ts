import type { AttachmentPathContext } from "@zotlit/db/path";
import type { QueryDataset } from "@zotlit/item-query";
import type { WorkbenchIdentity } from "@zotlit/template-workbench/worker/cli/workbench-identity.ts";
import type {
  ItemQueryAnswer,
  ItemQueryJob,
} from "@zotlit/zotero-reads/contract/item-query.ts";
import type { LibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";
import type {
  DecodedQuery,
  DecodedValues,
} from "@zotlit/zotero-reads/contract/query-codec.ts";

import type {
  QUERY_COMMAND,
  QUERY_SCHEMA_COMMAND,
  QueryCliCommand,
} from "./contract.ts";
import type { QueryViewOutcome, QueryViewRequest } from "./query-view.ts";
import type { WorkerMeasurement } from "./trace.ts";

export type QueryDatasetId = QueryDataset["id"];

export type QueryCommand = {
  command: QueryCliCommand;
} & (
  | { schema: true; pluginVersion: string; dataset?: QueryDatasetId }
  | { schema: false; values: DecodedValues; dataset?: never; query?: never }
  | { schema: false; query: DecodedQuery; dataset: QueryDatasetId }
);

export interface QueryViewCommand {
  command: typeof QUERY_COMMAND;
  schema: false;
  view: QueryViewRequest;
}

export interface QueryCustomFieldsCommand {
  command: typeof QUERY_SCHEMA_COMMAND;
  schema: false;
  customFields: true;
}

export type QueryJob = (
  | QueryCommand
  | QueryViewCommand
  | QueryCustomFieldsCommand
) & {
  id: string;
  vault: WorkbenchIdentity["vault"];
  scope: LibraryScope;
  uses?: Readonly<Record<string, number>>;
  attachmentPaths: AttachmentPathContext;
  stagePath?: string;
  measure?: boolean;
  heap?: boolean;
};

export type QueryReceipt =
  | { kind: "inline" }
  | { kind: "file"; path: string; bytes: number };

export interface QueryReply {
  command: QueryCliCommand;
  answer: string;
  receipt: QueryReceipt;
}

export interface QueryViewReply extends QueryReply {
  view: Exclude<QueryViewOutcome, { kind: "cancelled" }>;
}

export interface QueryAnswer extends QueryReply {
  cancelled?: true;
  view?: QueryViewReply["view"];
  customFields?: readonly string[];
  measurement?: WorkerMeasurement;
}

type Expect<T extends true> = T;
type Equals<A, B> = [A, B] extends [B, A] ? true : false;
type _Job = Expect<Equals<ItemQueryJob, QueryJob>>;
type _Answer = Expect<Equals<ItemQueryAnswer, QueryAnswer>>;

declare module "@zotlit/zotero-reads/contract/item-query.ts" {
  interface ItemQueryTypes {
    job: QueryJob;
    answer: QueryAnswer;
  }
}
