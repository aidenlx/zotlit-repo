import type { ZoteroPrefSnapshot } from "#core/zotero-pref/service.ts";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { libraryFilePaths } from "./paths.ts";
import { LibrarySource } from "./service.ts";
import type { LibrarySourceKind } from "./service.ts";

import { ZoteroPref } from "#core/zotero-pref/service.ts";

const pref = Layer.mock(ZoteroPref, {
  current: Effect.succeed(
    stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
      dataDir: "/home/ada/Zotero",
      baseAttachmentPath: "/home/ada/papers",
    }),
  ),
});

const sourceOf = (active: LibrarySourceKind) =>
  Layer.succeed(
    LibrarySource,
    stubService<LibrarySource["Service"]>("LibrarySource", { active }),
  );

it.effect(
  "gives the local Zotero folders for Zotero on this computer, and none for the online library",
  () =>
    Effect.gen(function* () {
      expect(
        yield* libraryFilePaths.pipe(
          Effect.provide(Layer.merge(pref, sourceOf("file"))),
        ),
      ).toEqual({
        dataDir: "/home/ada/Zotero",
        baseAttachmentPath: "/home/ada/papers",
      });
      expect(yield* libraryFilePaths.pipe(Effect.provide(pref))).toMatchObject({
        dataDir: "/home/ada/Zotero",
      });
      expect(
        yield* libraryFilePaths.pipe(
          Effect.provide(Layer.merge(pref, sourceOf("web-api"))),
        ),
      ).toEqual({ dataDir: null, baseAttachmentPath: null });
    }),
);
