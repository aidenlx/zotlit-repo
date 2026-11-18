import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { FileNotFound } from "@zotlit/plugin-kernel/vault-errors.ts";

import { saveLogArchive } from "./settings-rows.ts";

const LOG = ".obsidian/plugins/zotlit/zotlit.log";

/** The failure `effect` ends with over `vault`. */
const failureOf = <E>(
  effect: Effect.Effect<void, E, Vault>,
  vault: Partial<Vault["Service"]>,
) =>
  effect.pipe(
    Effect.provideService(Vault, stubService<Vault["Service"]>("Vault", vault)),
    Effect.flip,
  );

describe("log file actions", () => {
  it.effect("fails the export with the log file it cannot read", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(saveLogArchive(LOG), {
        readPath: (path) =>
          Effect.fail(new FileNotFound({ path, cause: null })),
      });
      expect(failure).toBeInstanceOf(FileNotFound);
      expect(failure).toMatchObject({ path: LOG });
    }),
  );
});
