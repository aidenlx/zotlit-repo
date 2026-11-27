import type { ItemQueryError } from "#desktop/item-query/service.ts";
import type { Cause } from "effect";
import { Effect, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { App, TFile } from "obsidian";
import { Keymap, parseLinktext } from "obsidian";

import { createNoteInteractively } from "@zotlit/notes/desktop/note-feature/creation-view.ts";
import type { InteractiveCreationPorts } from "@zotlit/notes/desktop/note-feature/creation-view.ts";
import { profileRevisionAtom } from "@zotlit/notes/obsidian/profile/atoms.ts";
import type { ProfileOperationError } from "@zotlit/notes/obsidian/profile/service.ts";
import { templateRevisionAtom } from "@zotlit/notes/obsidian/template/atoms.ts";
import type { TemplateFailure } from "@zotlit/notes/obsidian/template/service.ts";
import { processLiveFrontMatter } from "@zotlit/obsidian-kit/live-text.ts";
import type { LiveTextApp } from "@zotlit/obsidian-kit/live-text.ts";
import type { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { OpenLinkFailed } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type {
  ViewRegistryHandle,
  ViewServices,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { noteIndexSnapshotAtom } from "@zotlit/plugin-services/obsidian/note-index/atoms.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

import { replacedKeysAtom } from "./note-atoms.ts";

import { LITERATURE_NOTE } from "#core/query-view/query-file.ts";
import {
  assignedWidget,
  onTypesChanged,
} from "#obsidian/query-view/obsidian-private/metadata-type-manager.ts";
import {
  propertyValues,
  vaultTags,
} from "#obsidian/query-view/obsidian-private/property-values.ts";

export type LiteratureNoteLink = Pick<TFile, "path" | "basename">;

export type VaultPropertyType =
  | "text"
  | "multitext"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "tags"
  | "aliases";

export const LIST_TYPES: ReadonlySet<VaultPropertyType> = new Set([
  "multitext",
  "tags",
  "aliases",
]);

const ASSIGNABLE: ReadonlySet<string> = new Set<VaultPropertyType>([
  "text",
  "multitext",
  "number",
  "checkbox",
  "date",
  "datetime",
  "tags",
  "aliases",
]);

export interface VaultHost {
  readonly path: string;
  readonly itemKey: string;
}

export type VaultValue =
  | { readonly note: false }
  | { readonly note: true; readonly value: unknown };

export type VaultWrite = "written" | "created" | "cancelled" | "managed";

export interface VaultEdit {
  readonly itemKey: string;
  readonly name: string;
  readonly value: unknown;
  readonly host: VaultHost | null;
}

export interface VaultLinkRef {
  readonly target: string;
  readonly itemKey: string;
  readonly host: VaultHost | null;
}

export type NoteCreationFailure =
  | DbUnavailable
  | ItemQueryError
  | ProfileOperationError
  | TemplateFailure;

export interface LiteratureNotes {
  find(itemKey: string): LiteratureNoteLink | null;
  on(
    event: "changed" | "frontmatter-changed",
    listener: () => void,
  ): () => void;
  propertyNames(): readonly string[];
  itemKeys(): readonly string[];
  propertyType(name: string, value?: unknown): VaultPropertyType;
  read(itemKey: string, name: string, host: VaultHost | null): VaultValue;
  managed(itemKey: string, name: string, host: VaultHost | null): boolean;
  write(
    edit: VaultEdit,
  ): Effect.Effect<
    VaultWrite,
    NoteCreationFailure | Cause.UnknownError,
    ViewServices
  >;
  suggestions(name: string, type: VaultPropertyType): readonly string[];
  resolves(link: VaultLinkRef): boolean;
  openLink(
    link: VaultLinkRef,
    event: MouseEvent,
  ): Effect.Effect<void, OpenLinkFailed, ViewServices>;
  open(
    note: LiteratureNoteLink,
    event: MouseEvent,
  ): Effect.Effect<void, OpenLinkFailed, ViewServices>;
  create(
    itemKey: string,
  ): Effect.Effect<void, NoteCreationFailure, ViewServices>;
}

export interface LiteratureNotesDeps {
  registry: ViewRegistryHandle;
  app: App & LiveTextApp;
  creation: InteractiveCreationPorts;
  bridge: Pick<EffectBridge, "runSync">;
  vault: Pick<Vault["Service"], "getFileByPath">;
  metadata: Pick<MetadataCache["Service"], "cache" | "firstLinkpathDest">;
}

interface VaultMemo {
  names?: readonly string[];
  inferred?: ReadonlyMap<string, VaultPropertyType>;
}

const freshMemo = (): VaultMemo => ({});

export function literatureNotes(deps: LiteratureNotesDeps): LiteratureNotes {
  const { registry, bridge, vault, metadata } = deps;
  const memoAtom = Atom.map(noteIndexSnapshotAtom, () => freshMemo());
  const revisions = {
    changed: Atom.make(0),
    "frontmatter-changed": Atom.make(0),
  };
  const notify = (event: keyof typeof revisions) =>
    registry.update(revisions[event], (n) => n + 1);
  let listeners = 0;
  let offSources: (() => void) | null = null;
  const replacedSubscriptions = new Map<
    TFile,
    { path: string; release: () => void }
  >();
  const listen = () => {
    if (listeners++ === 0) {
      const releases = [
        registry.mount(noteIndexSnapshotAtom),
        registry.subscribe(noteIndexSnapshotAtom, (snapshot) => {
          notify(
            snapshot.change?.type === "frontmatter-changed"
              ? "frontmatter-changed"
              : "changed",
          );
        }),
      ];
      for (const atom of [profileRevisionAtom, templateRevisionAtom]) {
        releases.push(registry.mount(atom));
        releases.push(
          registry.subscribe(atom, () => notify("frontmatter-changed")),
        );
      }
      offSources = () => {
        for (const release of releases) release();
        for (const { release } of replacedSubscriptions.values()) release();
        replacedSubscriptions.clear();
      };
    }
    return () => {
      if (--listeners === 0) {
        offSources?.();
        offSources = null;
      }
    };
  };
  const replacedOf = (file: TFile) => {
    const atom = replacedKeysAtom(file.path);
    const result = registry.get(atom);
    const subscribed = replacedSubscriptions.get(file);
    if (listeners > 0 && subscribed?.path !== file.path) {
      subscribed?.release();
      replacedSubscriptions.set(file, {
        path: file.path,
        release: registry.subscribe(atom, (result) => {
          if (!result.waiting) notify("frontmatter-changed");
        }),
      });
    }
    return result;
  };
  let typeListeners = 0;
  let offTypes = () => {};
  const listenTypes = () => {
    if (typeListeners++ === 0)
      offTypes = onTypesChanged(deps.app, () => notify("frontmatter-changed"));
    return () => {
      if (--typeListeners === 0) offTypes();
    };
  };
  const inferredTypes = (): ReadonlyMap<string, VaultPropertyType> => {
    const memo = registry.get(memoAtom);
    if (memo.inferred) return memo.inferred;
    const inferred = new Map<string, VaultPropertyType>();
    for (const itemKey of registry.get(noteIndexSnapshotAtom).keys) {
      const note = firstNote(itemKey);
      if (!note) continue;
      for (const [name, value] of Object.entries(frontmatterOf(note.path)))
        if (!inferred.has(name) && value !== undefined && value !== null)
          inferred.set(name, inferType(value));
    }
    memo.inferred = inferred;
    return inferred;
  };
  const frontmatterOf = (path: string): Readonly<Record<string, unknown>> =>
    bridge.runSync(metadata.cache(path))?.frontmatter ?? {};
  const firstNote = (itemKey: string) =>
    registry
      .get(noteIndexSnapshotAtom)
      .notes.get(itemKey)
      ?.toSorted(
        (a, b) => b.stat.mtime - a.stat.mtime || a.path.localeCompare(b.path),
      )[0];
  const pathOf = (itemKey: string, host: VaultHost | null) =>
    host?.itemKey === itemKey ? host.path : firstNote(itemKey)?.path;
  const fileOf = (itemKey: string, host: VaultHost | null) => {
    const path = pathOf(itemKey, host);
    return path === undefined
      ? Effect.succeed(null)
      : vault.getFileByPath(path);
  };
  const createNote = Effect.fn("QueryView.createNote")(function* (
    itemKey: string,
  ) {
    const { reads } = yield* ZoteroReads;
    const item = (yield* reads.ItemsByIndexedKeys({
      indexedKeys: [itemKey],
    })).get(itemKey);
    return item ? yield* createNoteInteractively(deps.creation, item) : null;
  });
  return {
    find: (itemKey) => firstNote(itemKey) ?? null,
    on: (event, listener) => {
      const off = registry.subscribe(revisions[event], listener);
      const offSource = listen();
      if (event !== "frontmatter-changed")
        return () => {
          off();
          offSource();
        };
      const offTypes = listenTypes();
      return () => {
        off();
        offSource();
        offTypes();
      };
    },
    propertyNames: () =>
      (registry.get(memoAtom).names ??= registry
        .get(noteIndexSnapshotAtom)
        .names.filter((name) => `vault.${name}` !== LITERATURE_NOTE)),
    itemKeys: () => registry.get(noteIndexSnapshotAtom).keys,
    propertyType: (name, value) => {
      const assigned = assignedWidget(deps.app, name);
      if (assigned !== null && ASSIGNABLE.has(assigned))
        return assigned as VaultPropertyType;
      if (value !== undefined && value !== null) return inferType(value);
      return inferredTypes().get(name) ?? "text";
    },
    read: (itemKey, name, host) => {
      const path = pathOf(itemKey, host);
      if (path === undefined) return { note: false };
      return { note: true, value: frontmatterOf(path)[name] ?? null };
    },
    managed: (itemKey, name, host) => {
      const file = bridge.runSync(fileOf(itemKey, host));
      if (file === null) return false;
      const keys = replacedOf(file);
      return (
        !keys.waiting &&
        Option.getOrElse(AsyncResult.value(keys), () => new Set<string>()).has(
          name,
        )
      );
    },
    write: (edit) =>
      Effect.gen(function* () {
        const { itemKey, name, value, host } = edit;
        const found = yield* fileOf(itemKey, host);
        const file = found ?? (yield* createNote(itemKey));
        if (file === null) return "cancelled" as const;
        const keys = yield* AtomRegistry.getResult(
          registry,
          replacedKeysAtom(file.path),
          { suspendOnWaiting: true },
        );
        if (keys.has(name)) return "managed" as const;
        yield* Effect.tryPromise(() =>
          processLiveFrontMatter(deps.app, file, (frontmatter) => {
            frontmatter[name] = value;
          }),
        );
        return found === null ? ("created" as const) : ("written" as const);
      }),
    suggestions: (name, type) =>
      type === "tags" ? vaultTags(deps.app) : propertyValues(deps.app, name),
    resolves: ({ target, itemKey, host }) =>
      bridge.runSync(
        metadata.firstLinkpathDest(
          parseLinktext(target).path,
          pathOf(itemKey, host) ?? "",
        ),
      ) !== null,
    openLink: ({ target, itemKey, host }, event) =>
      Effect.flatMap(Workspace, (workspace) =>
        workspace.openLinkText(target, pathOf(itemKey, host) ?? "", {
          newLeaf: Keymap.isModEvent(event),
        }),
      ),
    open: (note, event) =>
      Effect.flatMap(Workspace, (workspace) =>
        workspace.openLinkText(note.path, "", {
          newLeaf: Keymap.isModEvent(event),
        }),
      ),
    create: (itemKey) => Effect.asVoid(createNote(itemKey)),
  };
}

export function inferType(value: unknown): VaultPropertyType {
  if (Array.isArray(value)) return "multitext";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "string" && /^\d{4}-[01]\d-[0-3]\d$/.test(value))
    return "date";
  if (
    typeof value === "string" &&
    /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/.test(value)
  )
    return "datetime";
  return "text";
}
