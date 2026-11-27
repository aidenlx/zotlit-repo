import type { Effect } from "effect";
import { Context } from "effect";

import type { VaultError } from "@zotlit/plugin-kernel/vault-errors.ts";

export class VaultDisk extends Context.Service<
  VaultDisk,
  {
    readonly basePath: string;
    fullPath(path: string): Effect.Effect<string>;
    reconcileFile(path: string): Effect.Effect<void, VaultError>;
  }
>()("zotlit/obsidian/VaultDisk") {}
