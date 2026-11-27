import { it } from "@effect/vitest";
import { Context, Effect } from "effect";
import { describe, expect } from "vitest";

import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { LibrarySource } from "@zotlit/plugin-services/obsidian/library-source/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";
import type { SourceIdentity } from "@zotlit/zotero-reads/contract/source-identity.ts";

import { readWorkbenchIdentity } from "./identity.ts";

const VAULT = { name: "Thesis", path: "/vaults/thesis" };

function identityOf(
  sourceIdentity: Effect.Effect<SourceIdentity, DbUnavailable>,
  active?: "file" | "web-api",
) {
  return readWorkbenchIdentity.pipe(
    Effect.provideService(
      ZoteroPref,
      stubService<ZoteroPref["Service"]>("ZoteroPref", {
        current: Effect.succeed({
          sourceId: "a1b2c3d4",
          databasePath: "/Zotero/zotero.sqlite",
        } as ZoteroPrefSnapshot),
      }),
    ),
    active
      ? Effect.provideService(
          LibrarySource,
          stubService<LibrarySource["Service"]>("LibrarySource", { active }),
        )
      : (effect) => effect,
    Effect.provideContext(
      Context.make(
        ObsidianEnv,
        stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
          vaultName: VAULT.name,
        }),
      ).pipe(
        Context.add(
          VaultDisk,
          stubService<VaultDisk["Service"]>("VaultDisk", {
            basePath: VAULT.path,
          }),
        ),
        Context.add(
          ZoteroReads,
          stubService<ZoteroReads["Service"]>("ZoteroReads", {
            reads: stubService<ZoteroReads["Service"]["reads"]>(
              "ZoteroReadsApi",
              {
                SourceIdentity: (() =>
                  sourceIdentity) as unknown as ZoteroReads["Service"]["reads"]["SourceIdentity"],
              },
            ),
          }),
        ),
      ),
    ),
  );
}

describe("readWorkbenchIdentity", () => {
  it.effect("names the source that ZoteroReads serves", () =>
    Effect.gen(function* () {
      const online: SourceIdentity = {
        kind: "web-api",
        id: "web-api:42",
        userID: 42,
        username: "researcher",
      };
      expect(yield* identityOf(Effect.succeed(online))).toEqual({
        vault: VAULT,
        source: online,
      });
      const file: SourceIdentity = {
        kind: "file",
        id: "a1b2c3d4",
        databasePath: "/Zotero/zotero.sqlite",
      };
      expect(yield* identityOf(Effect.succeed(file))).toEqual({
        vault: VAULT,
        source: file,
      });
    }),
  );

  it.effect(
    "names the Zotero database file of the preferences when the file source cannot be read, as before",
    () =>
      Effect.gen(function* () {
        const missing = Effect.fail(new DbUnavailable({ message: "missing" }));
        const fromPrefs = {
          vault: VAULT,
          source: {
            kind: "file",
            id: "a1b2c3d4",
            databasePath: "/Zotero/zotero.sqlite",
          },
        };
        expect(yield* identityOf(missing)).toEqual(fromPrefs);
        expect(yield* identityOf(missing, "file")).toEqual(fromPrefs);
      }),
  );

  it.effect("answers no source when the online library cannot be read", () =>
    Effect.gen(function* () {
      expect(
        yield* identityOf(
          Effect.fail(new DbUnavailable({ message: "missing" })),
          "web-api",
        ),
      ).toEqual({ vault: VAULT, source: null });
    }),
  );
});
