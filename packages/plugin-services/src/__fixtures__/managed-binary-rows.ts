// A Managed Binary and its row's button, for the tests of the rows that show
// a Managed Binary: this package's and its consumers'.
import { Effect, Stream } from "effect";
import { vi } from "vitest";

import { ButtonComponent } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type { Setting } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import type { ManagedBinaryError } from "#obsidian/managed-binary/platform.ts";
import type { ManagedBinaryApi, ManagedBinaryStatus } from "#obsidian/managed-binary/service.ts";

export /** A binary at `status` whose install and uninstall count their runs. */
function binary(
  status: ManagedBinaryStatus,
  outcome: Effect.Effect<void, ManagedBinaryError> = Effect.void,
) {
  const install = vi.fn(() => outcome);
  const uninstall = vi.fn(() => outcome);
  const members = {
    getStatus: Effect.succeed(status),
    changes: Stream.empty,
    install: Effect.suspend(install),
    uninstall: Effect.suspend(uninstall),
  };
  const api = stubService<ManagedBinaryApi<Disposable | AsyncDisposable>>(
    "ManagedBinary",
    members,
  );
  return { api, members, install, uninstall };
}

export function button(setting: Setting): ButtonComponent {
  const found = setting.components.find(
    (control) => control instanceof ButtonComponent,
  );
  if (!(found instanceof ButtonComponent)) throw new Error("No button");
  // The mock's shared stub element has no focus to drop.
  found.buttonEl = document.createElement("button");
  return found;
}
