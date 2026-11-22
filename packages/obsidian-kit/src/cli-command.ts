import type { Effect } from "effect";
import type { CliData, CliFlags, PluginManifest } from "obsidian";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { settleAtEdge } from "@zotlit/plugin-kernel/signal-edge.ts";

export type CliCommandHandler = (
  params: CliData,
) => Effect.Effect<string, unknown>;

export interface CliCommand {
  readonly description: string;
  readonly flags: CliFlags | null;
  readonly handler: CliCommandHandler;
}

export interface CliHost {
  registerCliCommand(name: string, command: CliCommand): void;
}

export type VersionedCliHost = CliHost & {
  readonly manifest: Pick<PluginManifest, "version">;
};

export type CliRunner = (
  effect: Effect.Effect<string, unknown>,
) => Promise<string>;

export function cliRunner(
  bridge: Pick<EffectBridge, "runPromiseExit">,
  signal: AbortSignal,
): CliRunner {
  return async (effect) =>
    settleAtEdge(await bridge.runPromiseExit(effect, { signal }), signal);
}
