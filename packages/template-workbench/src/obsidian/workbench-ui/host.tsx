// The host adapter: what only the host can answer — rendering, the vault's
// match vocabulary, where a field is inserted, and where a preference is kept
// (ADR 0044). The tree calls Obsidian's own menus, choosers, tooltips and
// notices directly.

import type {
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "#core/document/controller.ts";
import type { SuggestionSource } from "#core/language/completion.ts";
import type { RenderRequest } from "#core/render/request.ts";
import type {
  TemplateRenderResult,
  RenderedProperty,
  RenderedRange,
} from "#core/render/result.ts";
import type { Extension } from "@codemirror/state";
import { Data, Effect } from "effect";
import { createContext, useContext } from "react";
import type { ComponentType, HTMLAttributes, ReactNode } from "react";

import { useUniqueId } from "@zotlit/ui";

import type { WorkbenchSuggesterOption } from "./suggester.ts";

import { WorkbenchHostError } from "#core/language/host-effects.ts";

export { WorkbenchHostError };

/** The system clipboard refused the text. */
export class WorkbenchClipboardError extends Data.TaggedError(
  "WorkbenchClipboardError",
)<{ readonly cause: unknown }> {}

export interface WorkbenchDialogHandle {
  close(): void;
}

/** Suggestions anchored to a text field while the author types. */
export interface WorkbenchInputSuggestionsRequest {
  readonly input: HTMLInputElement;
  readonly getSuggestions: (query: string) => WorkbenchSuggesterOption[];
  readonly onSelect: (value: string) => void;
}

/** A Library as a Match condition names it (ADR 0039). */
export interface WorkbenchLibrary {
  /** `personal`, or `group:<groupID>`. */
  readonly id: "personal" | `group:${number}`;
  /** The host's display name, where it has one. */
  readonly name?: string;
}

/**
 * Whether an Item matches a filter:
 * - `result`: the filter holds for the Item, or not.
 * - `missing`: the host cannot read the Item.
 * - `problem`: the filter has a mistake. `span` is where it is in the filter
 *   text, where the mistake has a place.
 */
export type WorkbenchMatchResult =
  | { readonly kind: "result"; readonly matched: boolean }
  | { readonly kind: "missing" }
  /** An example item keeps no Attachments, Annotations, or Notes to test. */
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "problem";
      readonly message: string;
      readonly span?: { readonly from: number; readonly to: number };
    };

/** The names a Match condition can be written against, and its test. */
export interface WorkbenchMatchData {
  readonly tags: Effect.Effect<readonly string[], WorkbenchHostError>;
  /** Root-first Collection path segments; display formatting stays in the UI. */
  readonly collections: Effect.Effect<
    readonly (readonly string[])[],
    WorkbenchHostError
  >;
  readonly libraries: Effect.Effect<
    readonly WorkbenchLibrary[],
    WorkbenchHostError
  >;
  /**
   * Test the Item `indexedKey` against `filter`, a filter of the Items
   * dataset, as Profile selection tests it.
   */
  matches(
    indexedKey: string,
    filter: string,
  ): Effect.Effect<WorkbenchMatchResult, WorkbenchHostError>;
  /**
   * The names of the source's custom fields, which a condition reads as
   * `custom["<name>"]`; none where the source cannot answer.
   */
  readonly customFields: Effect.Effect<readonly string[], WorkbenchHostError>;
}

/** The Match data of a host that shows no Match: no names, no Item to test. */
export const NO_MATCH_DATA: WorkbenchMatchData = {
  tags: Effect.succeed([]),
  collections: Effect.succeed([]),
  libraries: Effect.succeed([]),
  matches: () => Effect.succeed({ kind: "missing" }),
  customFields: Effect.succeed([]),
};

/** The slice editor a field is inserted into, and where in it. */
export interface WorkbenchInsertTarget {
  readonly slice: WorkbenchSliceId;
  readonly range: WorkbenchSliceRange & {
    readonly anchor?: number;
    readonly head?: number;
    /**
     * The reader put the caret here: the pane has held focus. A pane that
     * only came on screen reports where its caret starts, without it.
     */
    readonly placed?: true;
  };
}

/** Per-device preferences follow the machine; per-vault ones follow the vault. */
export type WorkbenchPreferenceScope = "device" | "vault";

export interface WorkbenchPersistence {
  read(scope: WorkbenchPreferenceScope, key: string): string | null;
  /** `null` forgets the preference. */
  write(
    scope: WorkbenchPreferenceScope,
    key: string,
    value: string | null,
  ): void;
}

export interface WorkbenchMarkdownProps {
  readonly markdown: string;
  /** Identifies the output even when two surfaces contain the same text. */
  readonly surface: "note" | "annotation" | "citation" | "partial";
  readonly properties: readonly RenderedProperty[];
  /** The note's YAML block as the render wrote it, printed above `markdown` in the Markdown view. */
  readonly frontmatterBlock?: string | null;
  readonly showMarkdown: boolean;
  readonly marks?: readonly RenderedRange[];
}

/**
 * The Fields popover: the surface the Fields Panel opens in while it is not
 * pinned, at the right edge of the view. The host owns Escape, a press
 * outside, and focus at closing; it mounts `children` as the surface opens,
 * and the panel moves focus into its search field as it mounts.
 */
export interface WorkbenchFieldsPopoverProps {
  readonly open: boolean;
  /** The host closed the surface: Escape or a press outside. */
  readonly onClose: () => void;
  /** The id of the element that names the surface. */
  readonly labelledBy: string;
  /**
   * Whether focus the surface holds as it closes goes back to the Fields
   * action. False after an insert: the editor takes focus at the inserted
   * text.
   */
  readonly returnFocus: boolean;
  /**
   * Escape reached the surface. The panel answers `true` when it took the
   * key: it closed a field's details or cleared the search, and the surface
   * stays open. `false` leaves the key to the surface, which closes.
   */
  readonly onEscape: () => boolean;
  readonly children: ReactNode;
}

/**
 * One field's details in a wide view: a popover beside the Fields Panel, level
 * with the field's row. Inside the Fields popover it is a popover in that one,
 * so a press in either is inside both. The host closes it on Escape and on a
 * press outside it and its row, and leaves focus where it is as it opens.
 */
export interface WorkbenchFieldDetailsProps {
  /** The field's row, which the popover stands level with. */
  readonly anchor: HTMLElement;
  /** The Fields Panel, which the popover stands beside. */
  readonly panel: HTMLElement;
  /** The host closed the surface: Escape or a press outside. */
  readonly onClose: () => void;
  /** The id of the element that names the surface. */
  readonly labelledBy: string;
  readonly children: ReactNode;
}

/** The host's Fields action, and the Fields popover it opens. */
export interface WorkbenchFieldsAction {
  readonly popover: ComponentType<WorkbenchFieldsPopoverProps>;
  /** The id of the surface `popover` draws, which the action names while it stands. */
  readonly popoverId: string;
  /**
   * Moves focus to the action, as when a resize or a hide takes away the
   * docked panel that held it.
   */
  focus(): void;
  /**
   * The popover a field's details open in, in a view wide enough for it
   * beside the panel; mounted while the details stand open. Without one,
   * the details show in the bar at the panel's foot at every width.
   */
  readonly details?: ComponentType<WorkbenchFieldDetailsProps>;
  /**
   * The keyboard shortcut that inserts the selected field, as the platform
   * names it, such as "Ctrl+Enter" or "Command+Enter".
   */
  readonly insertShortcut: string;
}

/** The partial registry and the create flow one host owns for its editors. */
export interface WorkbenchPartials {
  /** The registered names, read per keystroke so a new file offers at once. */
  names(): readonly string[];
  /**
   * Name and create one partial, seeded with what the reader has typed.
   *
   * @returns the created name, or `null` when the reader dismisses the prompt.
   */
  create(query: string): Effect.Effect<string | null, WorkbenchHostError>;
}

export interface WorkbenchHost {
  /**
   * Suggestions under a Match text field while the author types. The Query
   * View's Filter leaves it out, as its popover stands over Obsidian's
   * suggestion popups; the field then lists its suggestions itself.
   */
  inputSuggestions?(
    request: WorkbenchInputSuggestionsRequest,
  ): WorkbenchDialogHandle;
  /**
   * Reveals the Pandoc engine's setting. Only the View with its Preview
   * supplies it; elsewhere a preview hint shows no button.
   */
  openCitationEngineSettings?: () => void;
  /** Puts `text` on the system clipboard, failing where the system refuses. */
  copy(text: string): Effect.Effect<void, WorkbenchClipboardError>;
  /** The community page this build belongs to, which Ask the community opens. */
  readonly communityUrl: string;
  /** The docs site this build belongs to, which each tab's guide link opens a page of. */
  readonly docsUrl: string;
  /** Renders one request; the tree schedules it through the Render Scheduler. */
  render: (
    request: RenderRequest,
  ) => Effect.Effect<TemplateRenderResult, WorkbenchHostError>;
  /** The host reading view for a rendered note or annotation. */
  markdown: ComponentType<WorkbenchMarkdownProps>;
  /** Completion and hover presentation, with the editor's mount for window-local overlays. */
  editorPopups(read: SuggestionSource, parent: HTMLElement): Extension;
  /**
   * The Shared Partials a render or include call completes from, and the flow
   * that creates one. The View supplies the vault's registered names; in a
   * mount without them, the draft's own scan answers.
   */
  partials?: WorkbenchPartials;
  matchData: WorkbenchMatchData;
  /** The focused slice editor, or `null` when none has had focus. */
  insertTarget(): WorkbenchInsertTarget | null;
  /**
   * The Fields action and the Fields popover it opens. Only the View supplies
   * it; a mount without it shows no Fields popover.
   */
  readonly fieldsAction?: WorkbenchFieldsAction;
  persistence: WorkbenchPersistence;
}

const HostContext = createContext<WorkbenchHost | null>(null);

export function WorkbenchHostProvider({
  host,
  children,
}: {
  host: WorkbenchHost;
  children?: ReactNode;
}) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function useWorkbenchHost(): WorkbenchHost {
  const host = useContext(HostContext);
  if (host === null) {
    throw new Error("The Workbench UI needs a WorkbenchHostProvider above it.");
  }
  return host;
}

/**
 * A container's accessible name, carried by a hidden element the container
 * points `aria-labelledby` at. Obsidian reads `aria-label` as an element's
 * hover tooltip, so a container names itself this way and stays quiet under
 * the pointer.
 */
export function HiddenName({ id, children }: { id: string; children: string }) {
  return (
    <span hidden id={id}>
      {children}
    </span>
  );
}

/**
 * A container's accessible name, which a {@link HiddenName} carries.
 * @returns The attributes for the container and the element to put in it.
 */
export function useContainerName(name: string): {
  attrs: HTMLAttributes<HTMLElement>;
  hiddenName: ReactNode;
} {
  const id = useUniqueId();
  return {
    attrs: { "aria-labelledby": id },
    hiddenName: <HiddenName id={id}>{name}</HiddenName>,
  };
}
