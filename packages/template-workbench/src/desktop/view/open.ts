import type {
  WorkbenchActionServices,
  WorkbenchOpened,
} from "#desktop/editor/actions.ts";
import type { ProfileTarget } from "#desktop/view/customize.ts";
import { Effect, Layer, Semaphore } from "effect";
import { TFile } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";

import { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import type { ArrivingProblem } from "@zotlit/notes/obsidian/template/workbench-recovery.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";

import {
  findWorkbenchLayout,
  openWorkbenchLayout,
  setLeafState,
  WORKBENCH_WINDOW,
} from "./layout.ts";
import {
  TEMPLATE_WORKBENCH_VIEW_TYPE,
  TemplateWorkbenchView,
} from "./view.tsx";

import { explainWorkbenchOpen } from "#desktop/editor/actions.ts";

const OPENED: WorkbenchOpened = { unavailableNote: null };

export interface WorkbenchOpenFrom {
  readonly leaf: WorkspaceLeaf;
  readonly place: "replace" | "tab" | "split";
}

export interface WorkbenchOpenOptions {
  readonly itemIndexedKey?: string;
  readonly originatingNote?: TFile;
  readonly tab?: "match" | "name";
  readonly customize?: boolean;
  readonly from?: WorkbenchOpenFrom;
  readonly problem?: ArrivingProblem;
}

const revealWorkbench = Effect.fn("TemplateWorkbench.revealWorkbench")(
  function* (leaf: WorkspaceLeaf) {
    yield* (yield* Workspace).revealLeaf(leaf);
    leaf.getContainer().focus();
    return leaf.view instanceof TemplateWorkbenchView ? leaf.view : null;
  },
);

const workbenchLeaf = Effect.fn("TemplateWorkbench.workbenchLeaf")(function* (
  window: TemplateWorkbenchView | null,
  from: WorkbenchOpenFrom | undefined,
  holds: (view: TemplateWorkbenchView) => boolean,
) {
  if (window) return window.leaf;
  const workspace = yield* Workspace;
  if (from && from.leaf.getContainer() !== (yield* workspace.rootSplit)) {
    if (from.place === "replace") return from.leaf;
    return from.place === "split"
      ? yield* workspace.createLeafBySplit(from.leaf)
      : yield* workspace.getLeaf("tab");
  }
  const held = (yield* workspace.leavesOfType(
    TEMPLATE_WORKBENCH_VIEW_TYPE,
  )).find(
    (leaf) => leaf.view instanceof TemplateWorkbenchView && holds(leaf.view),
  );
  return held ?? (yield* workspace.openPopoutLeaf(WORKBENCH_WINDOW));
});

const launchTurn = Semaphore.makeUnsafe(1);

const launchFile = Effect.fn("TemplateWorkbench.launchFile")(function* (
  file: TFile,
  options: WorkbenchOpenOptions & { defaultProfile?: boolean },
) {
  const { itemIndexedKey } = options;
  const workbench = yield* findWorkbenchLayout({
    file: file.path,
    defaultProfile: options.defaultProfile ?? false,
  });
  const leaf = yield* workbenchLeaf(
    workbench,
    options.from,
    (view) => view.file?.path === file.path,
  );
  yield* setLeafState(leaf, {
    type: TEMPLATE_WORKBENCH_VIEW_TYPE,
    state: {
      file: file.path,
      ...(workbench && !workbench.file ? { defaultDraft: false } : {}),
      ...(itemIndexedKey ? { itemIndexedKey } : {}),
      ...(options.tab ? { tab: options.tab, advanced: false } : {}),
    },
    active: true,
  });
  const view = yield* revealWorkbench(leaf);
  if (!view) return OPENED;
  if (options.problem) view.explainArrival(options.problem);
  yield* openWorkbenchLayout(view);
  return {
    unavailableNote: yield* view.setOriginatingNote(
      options.originatingNote ?? null,
    ),
  } satisfies WorkbenchOpened;
});

const launchTemplateWorkbench = Effect.fn(
  "TemplateWorkbench.openTemplateWorkbench",
)(function* (target: ProfileTarget, options: WorkbenchOpenOptions = {}) {
  const vault = yield* Vault;
  if (target instanceof TFile) return yield* launchFile(target, options);
  const path = target.defaultDocumentPath;
  const file = path ? yield* vault.getFileByPath(path) : null;
  if (file)
    return yield* launchFile(file, { ...options, defaultProfile: true });
  const { itemIndexedKey } = options;
  const workbench = yield* findWorkbenchLayout({
    file: null,
    defaultProfile: true,
  });
  if (workbench?.file) {
    return yield* launchFile(workbench.file, {
      ...options,
      defaultProfile: true,
    });
  }
  const leaf = yield* workbenchLeaf(
    workbench,
    options.from,
    (view) => view.isDefaultDraft,
  );
  yield* setLeafState(leaf, {
    type: TEMPLATE_WORKBENCH_VIEW_TYPE,
    state: {
      defaultDraft: true,
      file: null,
      ...(itemIndexedKey ? { itemIndexedKey } : {}),
    },
    active: true,
  });
  const view = yield* revealWorkbench(leaf);
  if (!view) return OPENED;
  if (options.problem) view.explainArrival(options.problem);
  if (options.customize) yield* view.customizeDefault();
  else yield* openWorkbenchLayout(view);
  return {
    unavailableNote: yield* view.setOriginatingNote(
      options.originatingNote ?? null,
    ),
  } satisfies WorkbenchOpened;
});

export const openTemplateWorkbench: typeof launchTemplateWorkbench = (
  target,
  options,
) => launchTurn.withPermit(launchTemplateWorkbench(target, options));

export type WorkbenchOpenError = Effect.Error<
  ReturnType<typeof openTemplateWorkbench>
>;

export type WorkbenchOpen = Effect.Effect<
  WorkbenchOpened | void,
  WorkbenchOpenError,
  WorkbenchActionServices
>;

export const layerTemplateWorkbenchLauncher = Layer.effect(
  TemplateWorkbenchLauncher,
  Effect.gen(function* () {
    const context = yield* Effect.context<
      Effect.Services<ReturnType<typeof openTemplateWorkbench>> | Notifier
    >();
    return TemplateWorkbenchLauncher.of({
      open: Effect.fn("TemplateWorkbenchLauncher.open")((file, options) =>
        openTemplateWorkbench(file, options).pipe(
          Effect.flatMap((opened) => explainWorkbenchOpen(opened)),
          Effect.provideContext(context),
        ),
      ),
    });
  }),
);
