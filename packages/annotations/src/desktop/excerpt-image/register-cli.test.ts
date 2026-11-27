import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import type { Scope } from "effect";
import { Effect, FileSystem, Layer } from "effect";
import { join } from "node:path";
import { describe, expect } from "vitest";

import { openScenarioDatabase } from "@zotlit/db-testing/scenario";
import { connectClient } from "@zotlit/db/client/node";
import type { CliCommand } from "@zotlit/obsidian-kit/cli-command.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import type { PluginHostShape } from "@zotlit/obsidian-kit/plugin-host.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import {
  inProcessClient,
  sharedClientOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import {
  layerZoteroReads,
  ZoteroReads,
} from "@zotlit/zotero-reads/client/service.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";
import { layerRcRef } from "@zotlit/zotero-reads/worker/connection.ts";

import { layerAnnotationImageCli } from "./register-cli.ts";

import { ANNOTATION_IMAGE_COMMAND } from "#obsidian/excerpt-image/cli-image.ts";
import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";

const registered = (
  reads: Layer.Layer<ZoteroReads>,
  dataDir: string,
): Effect.Effect<CliCommand, never, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const commands = new Map<string, CliCommand>();
    yield* Layer.build(
      layerAnnotationImageCli.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(
              PluginHost,
              stubService<PluginHostShape>("PluginHost", {
                registerCliCommand: (name, command) =>
                  void commands.set(name, command),
              }),
            ),
            reads,
            Layer.mock(ZoteroPref, {
              current: Effect.succeed(
                stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
                  dataDir,
                  baseAttachmentPath: null,
                }),
              ),
            }),
            Layer.succeed(
              ExcerptImageService,
              stubService<ExcerptImageService["Service"]>("ExcerptImages", {
                resolve: () => Effect.succeed({ kind: "unavailable" }),
              }),
            ),
          ),
        ),
      ),
    );
    const command = commands.get(ANNOTATION_IMAGE_COMMAND);
    if (!command) throw new Error("the command was not registered");
    return command;
  });

const scenarioReads = Effect.acquireDisposable(
  Effect.sync(() => openScenarioDatabase(connectClient, { annotations: true })),
).pipe(
  Effect.map((scenario) =>
    layerZoteroReads(
      inProcessClient(layerRcRef(sharedClientOpener(scenario.db))),
    ),
  ),
);

describe("zotlit:annotation-image registration", () => {
  it.effect(
    "answers source-unavailable where the database cannot be read",
    () =>
      Effect.gen(function* () {
        const command = yield* registered(
          Layer.succeed(
            ZoteroReads,
            stubService<ZoteroReads["Service"]>("ZoteroReads", {
              snapshot: Effect.fail(
                new DbUnavailable({ message: "database disk is locked" }),
              ),
            }),
          ),
          "/zotero",
        );

        const answer = JSON.parse(yield* command.handler({ key: "ANN2IMAG" }));

        expect(answer).toMatchObject({
          ok: false,
          diagnostic: {
            code: "source-unavailable",
            message: "database disk is locked",
          },
        });
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect(
    "tells a PDF missing on this device from one that would not render",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dataDir = yield* fs.makeTempDirectoryScoped();
        const command = yield* registered(yield* scenarioReads, dataDir);
        const answer = () =>
          command
            .handler({ key: "ANN2IMAG" })
            .pipe(Effect.map((text) => JSON.parse(text) as unknown));

        expect(yield* answer()).toMatchObject({
          diagnostic: { code: "file-unavailable" },
        });

        const pdf = join(dataDir, "storage", "PDF2LIVE", "exact.pdf");
        yield* fs.makeDirectory(join(dataDir, "storage", "PDF2LIVE"), {
          recursive: true,
        });
        yield* fs.writeFileString(pdf, "%PDF-1.7");

        expect(yield* answer()).toMatchObject({
          diagnostic: { code: "render-failed" },
        });
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
