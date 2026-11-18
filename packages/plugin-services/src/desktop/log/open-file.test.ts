import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import * as electron from "@zotlit/obsidian-desktop/require.ts";
import { LegacyPortError } from "@zotlit/obsidian-kit/legacy-port.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { openLogFileInSystem } from "./open-file.ts";

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
  it.effect("fails with the reason the system cannot open the log", () =>
    Effect.gen(function* () {
      const openPath = vi.fn(async () => "No app can open this file");
      yield* Effect.acquireDisposable(
        Effect.sync(() =>
          vi
            .spyOn(electron, "requireElectron")
            .mockReturnValue(
              stubService<ReturnType<typeof electron.requireElectron>>(
                "Electron",
                { shell: stubService<Electron.Shell>("Shell", { openPath }) },
              ),
            ),
        ),
      );
      const failure = yield* failureOf(openLogFileInSystem(LOG), {
        fullPath: (path) => Effect.succeed(`/vault/${path}`),
      });
      expect(openPath).toHaveBeenCalledWith(`/vault/${LOG}`);
      expect(failure).toBeInstanceOf(LegacyPortError);
      expect(failure.message).toBe("No app can open this file");
    }),
  );
});
