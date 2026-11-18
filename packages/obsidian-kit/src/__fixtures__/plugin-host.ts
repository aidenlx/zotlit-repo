// A PluginHost for tests: it keeps what a layer registers until the layer closes.
import type { App, Command, PluginManifest } from "obsidian";

import { Effect, Layer } from "effect";
import { PluginHost } from "#plugin-host.ts";
import type { PluginHostShape } from "#plugin-host.ts";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

/**
 * A host whose commands land in `commands` by the id the layer gave, and
 * leave it when the registering Scope closes. Any other member a test needs
 * comes in `members`; reading one it lacks throws.
 */
export function testPluginHost(
  members: Partial<Omit<PluginHostShape, "app" | "manifest">> & {
    app?: App;
    manifest?: Partial<PluginManifest>;
  } = {},
) {
  const commands = new Map<string, Command>();
  const host = stubService<PluginHostShape>("PluginHost", {
    addCommand: (command) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          commands.set(command.id, command);
          return command;
        }),
        () => Effect.sync(() => commands.delete(command.id)),
      ),
    ...(members as Partial<PluginHostShape>),
  });
  return { host, commands, layer: Layer.succeed(PluginHost, host) };
}
