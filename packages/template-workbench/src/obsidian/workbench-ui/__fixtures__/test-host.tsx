import type { RenderRequest } from "#core/render/request.ts";
import type { TemplateRenderResult } from "#core/render/result.ts";
import { Effect, Layer, Queue } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { Scope } from "obsidian";
import type { App } from "obsidian";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import {
  Menu,
  Notice,
  SuggestModal,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { AppContext } from "@zotlit/obsidian-kit/app-context.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { createWorkbenchEditor, WorkbenchEditorProvider } from "#obsidian/workbench-ui/editor.tsx";
import {
  WorkbenchClipboardError,
  WorkbenchHostError,
  WorkbenchHostProvider,
} from "#obsidian/workbench-ui/host.tsx";
import type {
  WorkbenchFieldDetailsProps,
  WorkbenchFieldsPopoverProps,
  WorkbenchHost,
  WorkbenchPreferenceScope,
} from "#obsidian/workbench-ui/host.tsx";
import type { WorkbenchModel, WorkbenchViewState } from "#obsidian/workbench-ui/model.ts";
import type { ViewSize, WorkbenchPanels } from "#obsidian/workbench-ui/panel-layout.ts";

import { WorkbenchDocumentController } from "#core/document/controller.ts";
import { DEFAULT_PROFILE_SOURCE } from "#core/render/default-profile.ts";
import { failedRender, renderIdentity } from "#core/render/result.ts";

export interface PendingRender {
  readonly request: RenderRequest;
  answer(result?: Partial<TemplateRenderResult>): void;
  reject(error: unknown): void;
  readonly interrupted: boolean;
  readonly interruption: Promise<void>;
}

export interface HeldRequest {
  readonly kind:
    | "copy"
    | "tags"
    | "collections"
    | "libraries"
    | "matches"
    | "customFields";
  answer(value: unknown): void;
  fail(error: unknown): void;
  readonly interrupted: boolean;
  readonly interruption: Promise<void>;
}

export interface FakeHost extends WorkbenchHost {
  readonly calls: {
    copies: string[];
    actionFocuses: number;
  };
  readonly renders: PendingRender[];
  readonly started: Queue.Queue<PendingRender>;
  hold: boolean;
  readonly held: HeldRequest[];
  readonly preferences: Map<string, string>;
  copyFails: boolean;
}

export function fakeHost(): FakeHost {
  Menu.instances.length = 0;
  Notice.instances.length = 0;
  const preferences = new Map<string, string>();
  const key = (scope: WorkbenchPreferenceScope, name: string) =>
    `${scope}:${name}`;
  const renders: PendingRender[] = [];
  const started = Effect.runSync(Queue.unbounded<PendingRender>());
  const held: HeldRequest[] = [];
  function holdable<A, E>(
    kind: HeldRequest["kind"],
    immediate: () => Effect.Effect<A, E>,
  ): Effect.Effect<A, E> {
    return Effect.suspend(() =>
      host.hold
        ? Effect.callback<A, E>((resume) => {
            let interrupted = false;
            const { promise, resolve } = Promise.withResolvers<void>();
            held.push({
              kind,
              answer: (value) => resume(Effect.succeed(value as A)),
              fail: (error) => resume(Effect.fail(error as E)),
              get interrupted() {
                return interrupted;
              },
              interruption: promise,
            });
            return Effect.sync(() => {
              interrupted = true;
              resolve();
            });
          })
        : immediate(),
    );
  }
  const host: FakeHost = {
    calls: {
      copies: [],
      actionFocuses: 0,
    },
    renders,
    started,
    hold: false,
    held,
    preferences,
    copyFails: false,
    copy: (text) =>
      holdable("copy", () => {
        host.calls.copies.push(text);
        return host.copyFails
          ? Effect.fail(
              new WorkbenchClipboardError({
                cause: new Error("Clipboard denied"),
              }),
            )
          : Effect.void;
      }),
    communityUrl: "https://example.invalid/community",
    docsUrl: "https://example.invalid",
    render: (request) =>
      Effect.callback<TemplateRenderResult, WorkbenchHostError>((resume) => {
        const identity = renderIdentity(request);
        let interrupted = false;
        const { promise, resolve } = Promise.withResolvers<void>();
        const pending: PendingRender = {
          request,
          answer: (result) =>
            resume(
              Effect.succeed({
                ...failedRender(identity, { code: "render-error" }),
                diagnostics: [],
                ...result,
              }),
            ),
          reject: (error) =>
            resume(Effect.fail(new WorkbenchHostError({ cause: error }))),
          get interrupted() {
            return interrupted;
          },
          interruption: promise,
        };
        renders.push(pending);
        Queue.offerUnsafe(started, pending);
        return Effect.sync(() => {
          interrupted = true;
          resolve();
        });
      }),
    markdown: ({ markdown }) => <div role="document">{markdown}</div>,
    matchData: {
      tags: holdable("tags", () => Effect.succeed(["reading", "methods"])),
      collections: holdable("collections", () =>
        Effect.succeed([["Thesis", "Chapter 1"]]),
      ),
      libraries: holdable("libraries", () =>
        Effect.succeed([{ id: "personal", name: "My Library" }] as const),
      ),
      matches: () =>
        holdable("matches", () =>
          Effect.succeed({ kind: "result", matched: false } as const),
        ),
      customFields: holdable("customFields", () =>
        Effect.succeed(["Reading status"]),
      ),
    },
    insertTarget: () => null,
    editorPopups: () => [],
    fieldsAction: {
      popover: FakeFieldsPopover,
      popoverId: "fake-fields-panel",
      details: FakeFieldDetails,
      insertShortcut: "Ctrl+Enter",
      focus: () => void host.calls.actionFocuses++,
    },
    persistence: {
      read: (scope, name) => preferences.get(key(scope, name)) ?? null,
      write: (scope, name, value) => {
        if (value === null) preferences.delete(key(scope, name));
        else preferences.set(key(scope, name), value);
      },
    },
  };
  return host;
}

export const TEST_APP = stubService<App>("App", {
  scope: new Scope(),
  keymap: stubService<App["keymap"]>("Keymap", {
    pushScope: () => {},
    popScope: () => {},
  }),
});

export function shownNotices(): string[] {
  return Notice.instances.map(({ message }) =>
    typeof message === "string" ? message : (message.textContent ?? ""),
  );
}

interface ChooserRow {
  id: string;
  label: string;
  hint?: string;
  group: string;
}

interface Chooser {
  getSuggestions(query: string): ChooserRow[];
  renderSuggestion(row: ChooserRow, el: HTMLElement): void;
  selectSuggestion(row: ChooserRow, event: MouseEvent | KeyboardEvent): void;
  close(): void;
}

export function watchChoosers() {
  const open = vi.spyOn(SuggestModal.prototype, "open");
  return {
    get last(): Chooser {
      const modal = open.mock.contexts.at(-1);
      if (!modal) throw new Error("No chooser has opened.");
      return modal as never;
    },
    get opened(): number {
      return open.mock.calls.length;
    },
    [Symbol.dispose]() {
      open.mockRestore();
    },
  };
}

export interface Mounted extends Disposable {
  host: FakeHost;
  registry: AtomRegistry.AtomRegistry;
  model: WorkbenchModel;
  controller: WorkbenchDocumentController;
  ui: ReactNode;
  wrap(children: ReactNode): ReactNode;
}

export const TEST_RUNTIME = Atom.runtime(Layer.empty);

export function mount(
  children: ReactNode,
  {
    source = DEFAULT_PROFILE_SOURCE,
    state,
    panels,
    viewSize,
  }: {
    source?: string;
    state?: Partial<WorkbenchViewState>;
    panels?: WorkbenchPanels;
    viewSize?: Atom.Atom<ViewSize | null>;
  } = {},
): Mounted {
  const host = fakeHost();
  const controller = new WorkbenchDocumentController(source);
  const registry = AtomRegistry.make({
    defaultIdleTTL: 0,
    timeoutResolution: 1,
  });
  const editor = createWorkbenchEditor({
    host,
    controller,
    registry,
    runtime: TEST_RUNTIME,
    ...(state ? { state } : {}),
    ...(panels ? { panels } : {}),
    ...(viewSize ? { viewSize } : {}),
  });
  const { model } = editor;
  const wrap = (children: ReactNode) => (
    <AppContext value={TEST_APP}>
      <WorkbenchHostProvider host={host}>
        <WorkbenchEditorProvider editor={editor}>
          {children}
        </WorkbenchEditorProvider>
      </WorkbenchHostProvider>
    </AppContext>
  );
  return {
    host,
    registry,
    model,
    controller,
    ui: wrap(children),
    wrap,
    [Symbol.dispose]() {
      editor[Symbol.dispose]();
      registry.dispose();
    },
  };
}

function FakeFieldsPopover({
  open,
  onClose,
  labelledBy,
  returnFocus,
  onEscape,
  children,
}: WorkbenchFieldsPopoverProps) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const doc = surface.current?.ownerDocument;
    if (!doc) return;
    const outside = (event: Event) => {
      if (!surface.current?.contains(event.target as Node)) onClose();
    };
    doc.addEventListener("pointerdown", outside, true);
    return () => doc.removeEventListener("pointerdown", outside, true);
  }, [open, onClose]);
  if (!open) return <span hidden data-return-focus={String(returnFocus)} />;
  return (
    <div
      ref={surface}
      id="fake-fields-panel"
      role="dialog"
      aria-labelledby={labelledBy}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !onEscape())
          onClose();
      }}
    >
      {children}
    </div>
  );
}

function FakeFieldDetails({
  anchor,
  panel,
  labelledBy,
  children,
}: WorkbenchFieldDetailsProps) {
  return (
    <div
      data-fake-details=""
      data-beside={panel.dataset.state}
      data-anchor={anchor
        .closest("[data-workbench-field]")
        ?.getAttribute("data-workbench-field")}
      aria-labelledby={labelledBy}
    >
      {children}
    </div>
  );
}
