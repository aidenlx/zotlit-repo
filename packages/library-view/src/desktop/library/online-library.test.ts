import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { buildQueryService } from "@zotlit/query-views/__fixtures__/item-query.ts";
import type { QueryFixture } from "@zotlit/query-views/__fixtures__/item-query.ts";
import { queryJobRunner } from "@zotlit/query-views/desktop/item-query/job.ts";
import { makeQueryJobRunner } from "@zotlit/query-views/worker/item-query/job.ts";
import type { QueryViewRequest } from "@zotlit/query-views/worker/item-query/query-view.ts";
import { openScenarioApi } from "@zotlit/web-library/fake-zotero-api/scenario";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { webApiReadsService } from "@zotlit/zotero-reads/__fixtures__/web-api-reads.ts";
import { fakeApiFetch } from "@zotlit/zotero-reads/__fixtures__/web-api.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";

import { paperCountRequest, tagListRequest } from "./document.ts";

let stack: AsyncDisposableStack;
let sources: { file: QueryFixture; web: QueryFixture };

beforeAll(async () => {
  stack = new AsyncDisposableStack();
  const scenario = stack.use(openScenarioApi());
  const desktop = scenario.pair.desktop;
  const fileReads = stack.use(
    inProcessReadsService(
      sharedClientOpener(desktop.db as NodeDatabaseClient),
      { handlers: { queryJobs: queryJobRunner } },
    ),
  );
  const webReads = stack.use(
    webApiReadsService(
      {
        api: scenario.api,
        key: scenario.key,
        fetch: fakeApiFetch(scenario.api),
      },
      { queryJobs: makeQueryJobRunner({ meter: {}, writesFiles: false }) },
    ),
  );
  const build = (reads: typeof fileReads) =>
    buildQueryService(
      {
        reads: reads.reads,
        source: {
          sourceId: "captured-source",
          databasePath: desktop.path,
          dataDir: dirname(desktop.path),
          baseAttachmentPath: join(dirname(desktop.path), "linked"),
        },
        effective: () => MY_LIBRARY_SCOPE,
        basePath: dirname(desktop.path),
      },
      stack,
    );
  sources = { file: await build(fileReads), web: await build(webReads) };
});

afterAll(() => stack.disposeAsync());

const groupsOf = async (fixture: QueryFixture, request: QueryViewRequest) => {
  const outcome = await fixture.handle.run(
    request,
    new AbortController().signal,
  );
  if (outcome.kind !== "result") throw new Error(outcome.kind);
  return (outcome.result.groups ?? []).map(({ value, count }) => ({
    value,
    count,
  }));
};

describe("the Library View over the online library", () => {
  it.each<[string, QueryViewRequest]>([
    [
      "the paper count of each collection",
      paperCountRequest({ type: "personal" }),
    ],
    [
      "the tag list of My Library",
      tagListRequest(
        { kind: "library", library: { type: "personal" } },
        [],
        MY_LIBRARY_SCOPE,
      ),
    ],
  ])("gives %s of the local Zotero database", async (_, request) => {
    const web = await groupsOf(sources.web, request);
    expect(web.length).toBeGreaterThan(0);
    expect(web).toEqual(await groupsOf(sources.file, request));
  });
});
