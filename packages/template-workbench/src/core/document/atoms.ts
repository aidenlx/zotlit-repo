import { Option } from "effect";
import * as Atom from "effect/reactivity/Atom";

import type {
  WorkbenchDocumentController,
  WorkbenchDocumentKind,
  WorkbenchProblem,
  WorkbenchSliceId,
} from "./controller.ts";
import type {
  ManagedEntrySource,
  WorkbenchSliceRange,
} from "./manifest-patch.ts";

export interface WorkbenchDocumentAtoms {
  readonly source: Atom.Atom<string>;
  readonly problems: Atom.Atom<readonly WorkbenchProblem[]>;
  readonly slices: Atom.Atom<
    ReadonlyMap<WorkbenchSliceId, WorkbenchSliceRange>
  >;
  readonly managedEntries: Atom.Atom<readonly ManagedEntrySource[] | null>;
  readonly kind: Atom.Atom<WorkbenchDocumentKind>;
  readonly parsed: Atom.Atom<boolean>;
  readonly manifest: Atom.Atom<WorkbenchDocumentController["manifest"]>;
  readonly readOnly: Atom.Atom<boolean>;
  readonly revision: Atom.Atom<number>;
}

export function workbenchDocumentAtoms(
  current: Atom.Atom<WorkbenchDocumentController>,
): WorkbenchDocumentAtoms {
  const fact = <A>(read: (controller: WorkbenchDocumentController) => A) =>
    Atom.readable((get) => {
      const controller = get(current);
      get.addFinalizer(
        controller.subscribe(({ docChanged }) => {
          if (docChanged) get.setSelf(read(controller));
        }),
      );
      return read(controller);
    });
  const revision = Atom.readable((get) => {
    const controller = get(current);
    let count = Option.getOrElse(get.self<number>(), () => -1) + 1;
    get.addFinalizer(controller.subscribe(() => get.setSelf(++count)));
    return count;
  });
  const readOnly = Atom.readable((get) => {
    const controller = get(current);
    get.addFinalizer(
      controller.subscribe(() => get.setSelf(controller.readOnly)),
    );
    return controller.readOnly;
  });
  return {
    revision,
    readOnly,
    kind: Atom.map(current, (controller) => controller.kind),
    parsed: fact((controller) => controller.parsed),
    manifest: fact((controller) => controller.manifest),
    source: fact((controller) => controller.source),
    problems: fact((controller) => controller.problems),
    slices: fact((controller) => controller.slices),
    managedEntries: fact((controller) => controller.managedEntries),
  };
}

const revisions = new WeakMap<WorkbenchDocumentController, Atom.Atom<number>>();

export function documentRevision(
  controller: WorkbenchDocumentController,
): Atom.Atom<number> {
  let revision = revisions.get(controller);
  if (revision === undefined) {
    revision = Atom.readable((get) => {
      let count = Option.getOrElse(get.self<number>(), () => 0);
      get.addFinalizer(controller.subscribe(() => get.setSelf(++count)));
      return count;
    });
    revisions.set(controller, revision);
  }
  return revision;
}
