import type { ManagedRuntime } from "effect";

import { cliRunner } from "@zotlit/obsidian-kit/cli-command.ts";
import type { CliRunner } from "@zotlit/obsidian-kit/cli-command.ts";
import { DisposableAbortController } from "@zotlit/obsidian-kit/disposables.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import type {
  FileMenuSegment,
  FolderMenuSegment,
} from "@zotlit/plugin-services/obsidian/file-menu.ts";
import type { LanguagePackStartup } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { pluginGraph } from "./compose.ts";
import type { HostDeclaration } from "./compose.ts";
import type {
  Feature,
  FeatureContext,
  HandlesOf,
  ShellPluginInstance,
} from "./feature.ts";
import { makeGraphBuilt } from "./graph-built.ts";

export interface ShellHandles {
  readonly runtime: ManagedRuntime.ManagedRuntime<any, never>;
  readonly bridge: EffectBridge;
  readonly runCli: CliRunner;
  readonly settings: PluginSettings["Service"];
  readonly notifier: Notifier["Service"];
  readonly workspace: Workspace["Service"];
  readonly metadataCache: MetadataCache["Service"];
  readonly viewRegistry: ViewRegistry["Service"];
}

export type ShellServices<F extends readonly Feature<any, any, any>[]> =
  ShellHandles & HandlesOf<F>;

export interface ShellRuntime<F extends readonly Feature<any, any, any>[]> {
  readonly services: ShellServices<F>;
  readonly context: FeatureContext;
}

export async function createShellRuntime<
  F extends readonly Feature<any, any, any>[],
>(
  plugin: ShellPluginInstance,
  stack: AsyncDisposableStack,
  {
    host,
    languagePack,
  }: {
    readonly host: HostDeclaration<F>;
    readonly languagePack: LanguagePackStartup;
  },
): Promise<ShellRuntime<F>> {
  const built = makeGraphBuilt();
  const runtime = buildRuntime(
    pluginGraph(plugin, host, { languagePack, built: built.layer }),
    stack,
  );
  await runtime.context();
  built.settle();
  const bridge = effectBridge(runtime);
  const runCli = cliRunner(
    bridge,
    stack.use(new DisposableAbortController()).signal,
  );

  const handles = new Map<Feature<any, any, any>, unknown>();
  const context: FeatureContext = {
    plugin,
    app: plugin.app,
    manifest: plugin.manifest,
    stack,
    runtime,
    bridge,
    read: (effect) => runtime.runSync(effect),
    handlesOf: <H>(feature: Feature<any, any, H>): H => {
      if (!handles.has(feature))
        throw new Error(`The host does not compose ${feature.name}`);
      return handles.get(feature) as H;
    },
  };
  const shell: ShellHandles = {
    runtime,
    bridge,
    runCli,
    settings: runtime.runSync(PluginSettings),
    notifier: runtime.runSync(Notifier),
    workspace: runtime.runSync(Workspace),
    metadataCache: runtime.runSync(MetadataCache),
    viewRegistry: runtime.runSync(ViewRegistry),
  };
  const made: unknown[] = [];
  for (const feature of host.features) {
    const value = feature.handles(context);
    made.push(value);
    for (
      let named: Feature<any, any, any> | undefined = feature;
      named;
      named = named.base
    )
      handles.set(named, value);
  }
  const services = Object.assign({}, shell, ...made) as ShellServices<F>;
  return { services, context };
}

export function runFeatureHooks<F extends readonly Feature<any, any, any>[]>(
  host: HostDeclaration<F>,
  context: FeatureContext,
): {
  readonly fileMenu: FileMenuSegment[];
  readonly folderMenu: FolderMenuSegment[];
} {
  const files = new Map<string, FileMenuSegment>();
  const folders = new Map<string, FolderMenuSegment>();
  for (const feature of host.features) {
    const menus = feature.onload(context);
    for (const [id, segment] of Object.entries(menus?.fileMenu ?? {}))
      files.set(id, segment);
    for (const [id, segment] of Object.entries(menus?.folderMenu ?? {}))
      folders.set(id, segment);
  }
  return {
    fileMenu: ordered(files, host.fileMenu),
    folderMenu: ordered(folders, host.folderMenu),
  };
}

function ordered<A>(entries: Map<string, A>, order: readonly string[]): A[] {
  const listed = order.flatMap((id) => {
    const entry = entries.get(id);
    return entry ? [entry] : [];
  });
  const rest = [...entries]
    .filter(([id]) => !order.includes(id))
    .map(([, entry]) => entry);
  return [...listed, ...rest];
}
