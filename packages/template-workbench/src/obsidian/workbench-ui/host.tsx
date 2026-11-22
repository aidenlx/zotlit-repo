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

export class WorkbenchClipboardError extends Data.TaggedError(
  "WorkbenchClipboardError",
)<{ readonly cause: unknown }> {}

export interface WorkbenchDialogHandle {
  close(): void;
}

export interface WorkbenchInputSuggestionsRequest {
  readonly input: HTMLInputElement;
  readonly getSuggestions: (query: string) => WorkbenchSuggesterOption[];
  readonly onSelect: (value: string) => void;
}

export interface WorkbenchLibrary {
  readonly id: "personal" | `group:${number}`;
  readonly name?: string;
}

export type WorkbenchMatchResult =
  | { readonly kind: "result"; readonly matched: boolean }
  | { readonly kind: "missing" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "problem";
      readonly message: string;
      readonly span?: { readonly from: number; readonly to: number };
    };

export interface WorkbenchMatchData {
  readonly tags: Effect.Effect<readonly string[], WorkbenchHostError>;
  readonly collections: Effect.Effect<
    readonly (readonly string[])[],
    WorkbenchHostError
  >;
  readonly libraries: Effect.Effect<
    readonly WorkbenchLibrary[],
    WorkbenchHostError
  >;
  matches(
    indexedKey: string,
    filter: string,
  ): Effect.Effect<WorkbenchMatchResult, WorkbenchHostError>;
  readonly customFields: Effect.Effect<readonly string[], WorkbenchHostError>;
}

export const NO_MATCH_DATA: WorkbenchMatchData = {
  tags: Effect.succeed([]),
  collections: Effect.succeed([]),
  libraries: Effect.succeed([]),
  matches: () => Effect.succeed({ kind: "missing" }),
  customFields: Effect.succeed([]),
};

export interface WorkbenchInsertTarget {
  readonly slice: WorkbenchSliceId;
  readonly range: WorkbenchSliceRange & {
    readonly anchor?: number;
    readonly head?: number;
    readonly placed?: true;
  };
}

export type WorkbenchPreferenceScope = "device" | "vault";

export interface WorkbenchPersistence {
  read(scope: WorkbenchPreferenceScope, key: string): string | null;
  write(
    scope: WorkbenchPreferenceScope,
    key: string,
    value: string | null,
  ): void;
}

export interface WorkbenchMarkdownProps {
  readonly markdown: string;
  readonly surface: "note" | "annotation" | "citation" | "partial";
  readonly properties: readonly RenderedProperty[];
  readonly frontmatterBlock?: string | null;
  readonly showMarkdown: boolean;
  readonly marks?: readonly RenderedRange[];
}

export interface WorkbenchFieldsPopoverProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly labelledBy: string;
  readonly returnFocus: boolean;
  readonly onEscape: () => boolean;
  readonly children: ReactNode;
}

export interface WorkbenchFieldDetailsProps {
  readonly anchor: HTMLElement;
  readonly panel: HTMLElement;
  readonly onClose: () => void;
  readonly labelledBy: string;
  readonly children: ReactNode;
}

export interface WorkbenchFieldsAction {
  readonly popover: ComponentType<WorkbenchFieldsPopoverProps>;
  readonly popoverId: string;
  focus(): void;
  readonly details?: ComponentType<WorkbenchFieldDetailsProps>;
  readonly insertShortcut: string;
}

export interface WorkbenchPartials {
  names(): readonly string[];
  create(query: string): Effect.Effect<string | null, WorkbenchHostError>;
}

export interface WorkbenchHost {
  inputSuggestions?(
    request: WorkbenchInputSuggestionsRequest,
  ): WorkbenchDialogHandle;
  openCitationEngineSettings?: () => void;
  copy(text: string): Effect.Effect<void, WorkbenchClipboardError>;
  readonly communityUrl: string;
  readonly docsUrl: string;
  render: (
    request: RenderRequest,
  ) => Effect.Effect<TemplateRenderResult, WorkbenchHostError>;
  markdown: ComponentType<WorkbenchMarkdownProps>;
  editorPopups(read: SuggestionSource, parent: HTMLElement): Extension;
  partials?: WorkbenchPartials;
  matchData: WorkbenchMatchData;
  insertTarget(): WorkbenchInsertTarget | null;
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

export function HiddenName({ id, children }: { id: string; children: string }) {
  return (
    <span hidden id={id}>
      {children}
    </span>
  );
}

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
