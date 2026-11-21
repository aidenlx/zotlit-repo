// Test host translating the old boundary fixtures to Effect service fakes.
import { Context, Effect, Layer, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type { App } from "obsidian";
import { onTestFinished } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { MetadataEvent } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { ViewServices } from "@zotlit/obsidian-kit/view-atoms.ts";
import { makeViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import type { SubscriptionRuntime } from "@zotlit/plugin-kernel/effect-stream.ts";
import { vaultError } from "@zotlit/plugin-kernel/vault-errors.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import type { SearchOptions } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { ItemSnapshot } from "@zotlit/zotero-reads/contract/snapshot/types.ts";
import { chooseItem, setPreview } from "#obsidian/workbench-ui/index.tsx";
import type {
  WorkbenchHost,
  WorkbenchItemChoice,
  WorkbenchPreviewSettings,
} from "#obsidian/workbench-ui/index.tsx";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type {
  ZoteroReadLease,
  ZoteroReadsState,
} from "@zotlit/zotero-reads/client/service.ts";

import { layerUnreadViewServices } from "@zotlit/notes/__fixtures__/view-atoms.ts";
import { ItemMatchQuery } from "@zotlit/notes/core/profile-selection/item-matches.ts";
import type {
  BatchMatches,
  MatchItem,
} from "@zotlit/notes/core/profile-selection/item-matches.ts";
import { NoteWriteAborted } from "@zotlit/notes/obsidian/note-feature/errors.ts";
import type { NoteFeatureHandle } from "@zotlit/notes/desktop/note-feature/operations.ts";
import { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { defaults } from "@zotlit/notes/__fixtures__/settings.ts";
import type { TemplateDataDeps } from "@zotlit/notes/desktop/template/data.ts";
import type { TemplateOperations } from "@zotlit/notes/obsidian/template/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import type { ExplorerViewDeps } from "#desktop/data-explorer/view.tsx";
import type { PreviewRenderDeps } from "#desktop/view/preview/render.ts";

import type { WorkbenchActionServices } from "#desktop/editor/actions.ts";
import type { TemplateWorkbenchDeps, TemplateWorkbenchView } from "#desktop/view/view.tsx";
type TemplateFixture = TemplateOperations & {
  readonly "compile-status-changed": Stream.Stream<void>;
};
type ZoteroReadsFixture = {
  state: ZoteroReadsState["state"];
  reads: ZoteroReads["Service"]["reads"];
  acquireRead(): Promise<ZoteroReadLease>;
  changed: Stream.Stream<void>;
  degraded: Stream.Stream<unknown>;
  "refresh-failed": Stream.Stream<unknown>;
  refreshing: Stream.Stream<boolean>;
  "db-file-missing": Stream.Stream<void>;
  "refresh-requested": Stream.Stream<void>;
};

export type WorkbenchHostDeps = Omit<
  ExplorerViewDeps,
  "pluginVersion" | "registry"
> &
  TemplateDataDeps & {
    services?: {
      template?: Template["Service"];
      profile?: Profile["Service"];
      zoteroReads?: ZoteroReads["Service"];
    };
    app?: App;
    runtime: SubscriptionRuntime;
    zoteroReads: Pick<
      ZoteroReadsFixture,
      | "state"
      | "reads"
      | "changed"
      | "degraded"
      | "refresh-failed"
      | "refreshing"
      | "db-file-missing"
      | "refresh-requested"
      | "acquireRead"
    >;
  } & {
    zoteroPref: Pick<ZoteroPrefSnapshot, "dataDir">;
    noteFeature?: Pick<NoteFeatureHandle, "updateNote">;
    /**
     * ZotLit Query, which tests the Match of a Profile on a real Item and names
     * the custom fields a condition reads.
     */
    query?: {
      matches(
        items: readonly MatchItem[],
        filters: readonly string[],
        signal: AbortSignal,
      ): Promise<BatchMatches>;
      customFieldNames(signal: AbortSignal): Promise<readonly string[]>;
    };
    render?: WorkbenchHost["render"];
    previewRender?: PreviewRenderDeps;
    pluginVersion?: string;
    templates: Pick<TemplateFixture, "javascriptTemplatesEnabled"> &
      Pick<
        TemplateFixture,
        | "waitUntilSettled"
        | "loaded"
        | "compile-status-changed"
        | "materializeCitationTemplate"
        | "getPartialDocument"
        | "getPartialDocuments"
        | "getPartialNames"
        | "createPartial"
        | "planPartialUnpack"
        | "unpackPartials"
      >;
    profile?: Pick<
      Profile["Service"],
      | "profiles"
      | "getSource"
      | "profileOf"
      | "getBuiltInSource"
      | "materializeDefault"
      | "restoreDefault"
      | "defaultDocumentPath"
    >;
  };

/**
 * The services a Workbench launch runs with: `notifier`, and a vault, a
 * workspace and the Profile service whose members each test supplies when
 * its launch reads them.
 */
export function workbenchActionContext(
  notifier: Notifier["Service"] = testNotifier().service,
  services: {
    vault?: Partial<Vault["Service"]>;
    workspace?: Partial<Workspace["Service"]>;
    profile?: Partial<Profile["Service"]>;
  } = {},
): Context.Context<WorkbenchActionServices> {
  return Context.make(Notifier, notifier).pipe(
    Context.add(
      Vault,
      stubService<Vault["Service"]>("Vault", services.vault ?? {}),
    ),
    Context.add(
      Workspace,
      stubService<Workspace["Service"]>("Workspace", services.workspace ?? {}),
    ),
    Context.add(
      Profile,
      stubService<Profile["Service"]>("Profile", services.profile ?? {}),
    ),
  );
}

export function makeWorkbenchHost<Unread = never>(
  input: Partial<WorkbenchHostDeps> = {},
  options: {
    metadata?: Stream.Stream<MetadataEvent>;
    /**
     * The view services the test leaves unread. A host's test passes its own:
     * the host's program registers more view services than this package.
     */
    unread?: Layer.Layer<Unread>;
  } = {},
) {
  const deps = stubService<WorkbenchHostDeps>("WorkbenchHostDeps", {
    settings: { current: Effect.succeed(defaults), changes: Stream.empty },
    app: undefined,
    services: undefined,
    profile: undefined,
    noteFeature: undefined,
    previewRender: undefined,
    render: undefined,
    pluginVersion: undefined,
    query: undefined,
    itemLookup: stubService<WorkbenchHostDeps["itemLookup"]>("ItemLookup", {}),
    bridge: stubService<WorkbenchHostDeps["bridge"]>("EffectBridge", {}),
    zoteroPref: { dataDir: "/Zotero" },
    zoteroReads: stubService<WorkbenchHostDeps["zoteroReads"]>("ZoteroReads", {
      state: "ready",
    }),
    templates: stubService<WorkbenchHostDeps["templates"]>("Template", {
      loaded: true,
      javascriptTemplatesEnabled: false,
      getPartialNames: () => [],
      getPartialDocuments: () => [],
      "compile-status-changed": Stream.empty,
    }),
    ...input,
  });
  const template = stubService<Template["Service"]>("Template", {
    javascriptTemplatesEnabled: Effect.sync(
      () => deps.templates.javascriptTemplatesEnabled,
    ),
    status: Effect.sync(() => ({
      state: deps.templates.loaded ? "loaded" : "loading",
      compileErrors: new Map(),
    })),
    changes: Stream.suspend(() =>
      Stream.make({
        state: deps.templates.loaded ? "loaded" : "loading",
        compileErrors: new Map(),
      }),
    ),
    compileEvents: Stream.suspend(() =>
      "compile-status-changed" in deps.templates
        ? deps.templates["compile-status-changed"]
        : Stream.empty,
    ),
    getPartialNames: Effect.sync(() => deps.templates.getPartialNames()),
    getPartialDocuments: Effect.sync(() =>
      deps.templates.getPartialDocuments(),
    ),
    getPartialDocument: (name) =>
      Effect.sync(() => deps.templates.getPartialDocument(name)),
    waitUntilSettled: (timeout) =>
      Effect.promise((signal) => {
        signal.throwIfAborted();
        return deps.templates.waitUntilSettled(timeout);
      }),
    materializeCitationTemplate: Effect.promise((signal) => {
      signal.throwIfAborted();
      return deps.templates.materializeCitationTemplate();
    }),
    planPartialUnpack: (bundled) =>
      Effect.sync(() => deps.templates.planPartialUnpack(bundled)),
    unpackPartials: (plan) =>
      Effect.promise((signal) => {
        signal.throwIfAborted();
        return deps.templates.unpackPartials(plan);
      }),
    createPartial: (name, options) =>
      Effect.promise((signal) => {
        signal.throwIfAborted();
        return deps.templates.createPartial(name, options);
      }),
  });
  const profileState = Effect.gen(function* () {
    return {
      loaded: true,
      profiles:
        deps.profile && "profiles" in deps.profile
          ? yield* deps.profile.profiles
          : [],
      diagnostics: [],
      defaultDocumentPath:
        deps.profile && "defaultDocumentPath" in deps.profile
          ? yield* deps.profile.defaultDocumentPath
          : "templates/zotlit-profile.default.md",
      templateStatus: { state: "loaded" as const, compileErrors: new Map() },
    };
  });
  const profile = stubService<Profile["Service"]>("Profile", {
    state: profileState,
    changes: Stream.fromEffect(profileState),
    profileOf: (file) => Effect.suspend(() => deps.profile!.profileOf(file)),
    getBuiltInSource: Effect.suspend(() => deps.profile!.getBuiltInSource),
    getSource: (selector) =>
      Effect.suspend(() => deps.profile!.getSource(selector)),
    materializeDefault: Effect.suspend(() => deps.profile!.materializeDefault),
    restoreDefault: Effect.suspend(() => deps.profile!.restoreDefault),
  });
  const dbState = () => ({
    state: deps.zoteroReads.state,
    error: null,
    moved: false,
    dbFileMissing: false,
    activeReadMode: null,
  });
  const context = Context.make(
    PluginSettings,
    stubService<PluginSettings["Service"]>("PluginSettings", {
      current: deps.settings?.current ?? Effect.succeed(defaults),
      changes: Stream.concat(
        Stream.fromEffect(deps.settings?.current ?? Effect.succeed(defaults)),
        "changes" in deps.settings ? deps.settings.changes : Stream.empty,
      ),
    }),
  ).pipe(
    Context.add(Template, deps.services?.template ?? template),
    Context.add(Notifier, testNotifier().service),
    // The Item search over the test's lookup handle.
    Context.add(
      ItemLookup,
      stubService<ItemLookup["Service"]>("ItemLookup", {
        search: (query, opts) =>
          Effect.promise(() => deps.itemLookup.search(query, opts)),
        openSession: Effect.map(
          Effect.acquireDisposable(
            Effect.sync(() => deps.itemLookup.openSession()),
          ),
          (session) => ({
            search: (query: string, opts?: SearchOptions) =>
              Effect.promise(() => session.search(query, opts)),
          }),
        ),
      }),
    ),
    Context.add(Profile, deps.services?.profile ?? profile),
    Context.add(
      ZoteroReads,
      deps.services?.zoteroReads ??
        stubService<ZoteroReads["Service"]>("ZoteroReads", {
          current: Effect.sync(dbState),
          changes: Stream.suspend(() => Stream.make(dbState())),
          events: Stream.suspend(() =>
            Stream.map(
              "changed" in deps.zoteroReads
                ? deps.zoteroReads.changed
                : Stream.empty,
              () => ({ _tag: "changed" as const }),
            ),
          ),
          reads: stubService<ZoteroReads["Service"]["reads"]>(
            "ZoteroReadsApi",
            {
              ItemsByIndexedKeys: (request) =>
                deps.zoteroReads.reads.ItemsByIndexedKeys(request),
            },
          ),
          snapshot: Effect.map(
            Effect.acquireDisposable(
              Effect.promise((signal) => {
                signal.throwIfAborted();
                return deps.zoteroReads.acquireRead();
              }),
            ),
            (lease) => lease.reads,
          ),
        }),
    ),
    Context.add(
      ZoteroPref,
      stubService<ZoteroPref["Service"]>("ZoteroPref", {
        current: Effect.sync(() =>
          stubService<
            import("@zotlit/plugin-services/core/zotero-pref/service.ts").ZoteroPrefSnapshot
          >("ZoteroPrefSnapshot", { dataDir: deps.zoteroPref.dataDir }),
        ),
      }),
    ),
    Context.add(
      ItemMatchQuery,
      stubService<ItemMatchQuery["Service"]>("ItemMatchQuery", {
        matches: (items, filters) =>
          Effect.promise((signal) => deps.query!.matches(items, filters, signal)),
        customFieldNames: Effect.promise(
          (signal) =>
            deps.query?.customFieldNames(signal) ?? Promise.resolve([]),
        ),
      }),
    ),
    Context.add(
      MetadataCache,
      stubService<MetadataCache["Service"]>("MetadataCache", {
        changes: options.metadata ?? Stream.empty,
      }),
    ),
    Context.add(
      Vault,
      stubService<Vault["Service"]>("Vault", {
        getFileByPath: (path) =>
          Effect.sync(() => deps.app!.vault.getFileByPath(path)),
        read: (file) =>
          Effect.tryPromise({
            try: () => deps.app!.vault.read(file),
            catch: vaultError("read", file.path),
          }),
      }),
    ),
    Context.add(
      NoteFeature,
      stubService<NoteFeature["Service"]>("NoteFeature", {
        // The service's write runs to its end once started; a rejection is
        // what the note operation's write stopped on.
        updateNote: (file, options) =>
          Effect.uninterruptible(
            Effect.tryPromise({
              try: () => deps.noteFeature!.updateNote(file, options),
              catch: (cause) =>
                new NoteWriteAborted({ path: file.path, cause }),
            }),
          ),
      }),
    ),
    Context.add(
      Workspace,
      stubService<Workspace["Service"]>("Workspace", {
        getLeaf: (pane) => Effect.sync(() => deps.app!.workspace.getLeaf(pane)),
      }),
    ),
  );
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    Layer.mergeAll(
      options.unread ?? layerUnreadViewServices,
      Layer.succeedContext(context),
    ),
    stack,
  );
  // The context holds every view service of the program that runs the test;
  // a host's test supplies the services this package does not know.
  const registry = makeViewRegistry(
    runtime.runSync(Effect.context<never>()) as Context.Context<ViewServices>,
    { idleTTL: 0 },
  );
  const owners: (() => void | Promise<void>)[] = [];
  onTestFinished(async () => {
    for (const close of owners.reverse()) await close();
    registry.dispose();
    await stack.disposeAsync();
  });
  return {
    registry,
    own: (close: () => void | Promise<void>) => owners.push(close),
    deps: {
      registry,
      previewRender: deps.previewRender,
      render: deps.render,
      pluginVersion: deps.pluginVersion,
      itemLookup: deps.itemLookup,
      settings: deps.settings,
      bridge: deps.bridge,
    } satisfies TemplateWorkbenchDeps,
  };
}

/** The view state a Template Workbench View's leaf holds. */
export const viewState = (view: TemplateWorkbenchView) =>
  view.registry.get(view.model.view);

/** Makes `item` the leaf's choice, as a chooser does. */
export const setViewItem = (
  view: TemplateWorkbenchView,
  item: WorkbenchItemChoice | null,
) => view.registry.update(view.model.view, chooseItem(item));

/** The leaf's render state, as its tabs read it. */
export const renderState = (view: TemplateWorkbenchView) =>
  view.registry.get(view.workbench.scheduler.state);

/** Renders the draft now, as Run does. */
export const runRender = (view: TemplateWorkbenchView) =>
  view.registry.set(view.workbench.scheduler.run, undefined);

/** Chooses the Sample Item `snapshot` is, under the preview settings given. */
export function chooseSample(
  view: TemplateWorkbenchView,
  snapshot: ItemSnapshot,
  settings: Partial<WorkbenchPreviewSettings> = {},
) {
  if (snapshot.provenance.kind !== "sample")
    throw new Error("A Sample Item has sample provenance.");
  const id = `sample:${snapshot.provenance.id}`;
  Atom.batch(() => {
    view.registry.update(view.workbench.choices, setPreview(settings));
    if (view.registry.get(view.model.view).item?.id !== id)
      setViewItem(view, { id, title: snapshot.item.title });
  });
}
