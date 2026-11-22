import type {
  ManagedFrontmatterPreparationFailure,
  PreparedManagedFrontmatter,
} from "#core/note-feature/frontmatter.ts";
import type { ResolvedProfile } from "#obsidian/profile/bindings.ts";
import type {
  ResolvedLiteratureNoteTemplate,
  TemplateOperations,
} from "#obsidian/template/service.ts";
import { stringifyYaml } from "obsidian";

import type { NoteTemplateContext } from "@zotlit/db";
import {
  FIELD_CITATION_STYLE,
  FIELD_LITERATURE_NOTE_PROFILE,
} from "@zotlit/plugin-kernel/constants.ts";
import { stringifyFrontmatterInOrder } from "@zotlit/templates/frontmatter";
import type { ManagedFrontmatterEvaluation } from "@zotlit/templates/frontmatter";
import type { FrontmatterMergeConflictHandler } from "@zotlit/templates/frontmatter-merge";

import {
  applyDocumentManagedFrontmatter,
  applyManagedFrontmatter,
  prepareManagedFrontmatter,
} from "#core/note-feature/frontmatter.ts";

export type ComposeWarn = (
  message: string,
  annotations: Record<string, unknown>,
) => void;

export interface ComposeNoteDeps {
  template: Pick<TemplateOperations, "render" | "frontmatterFields">;
  warn?: ComposeWarn;
  events?: {
    emit: (
      event: "frontmatter-eval-failed",
      payload: { itemKey: string; fields: string[] },
    ) => void;
  };
}

export type ComposeProfile = Pick<ResolvedProfile, "stamp" | "citationStyle">;

export interface ComposeFrontmatterInput {
  context: NoteTemplateContext;
  itemKey: string;
  profile: ComposeProfile;
  prepared: PreparedManagedFrontmatter;
  onConflict?: FrontmatterMergeConflictHandler;
}

export interface ComposeNoteInput extends Omit<
  ComposeFrontmatterInput,
  "prepared"
> {
  document: ResolvedLiteratureNoteTemplate | undefined;
  now: Temporal.Instant;
}

export interface ComposedNote {
  readonly outcome: "composed";
  readonly prepared: PreparedManagedFrontmatter;
  readonly frontmatter: Record<string, unknown>;
  readonly frontmatterBlock: string;
  readonly body: string;
  readonly content: string;
}

export interface ComposeRefusal {
  readonly outcome: "refused";
  readonly failures: [
    ManagedFrontmatterPreparationFailure,
    ...ManagedFrontmatterPreparationFailure[],
  ];
  readonly evaluation: ManagedFrontmatterEvaluation;
  readonly prepared: PreparedManagedFrontmatter;
}

export interface PreparedComposition {
  readonly outcome: "prepared";
  readonly prepared: PreparedManagedFrontmatter;
  readonly body: string;
}

export function prepareLiteratureNote(
  deps: ComposeNoteDeps,
  input: Pick<ComposeNoteInput, "context" | "document" | "now">,
): PreparedComposition | ComposeRefusal {
  const result = prepareManagedFrontmatter(
    input.document?.frontmatter,
    input.context,
    input.now,
  );
  if ("failures" in result)
    return {
      outcome: "refused",
      ...result,
      prepared: {
        kind: "document",
        fields: result.evaluation.values,
        keys: result.evaluation.keys,
      },
    };
  const body = input.document
    ? input.document.renderForCreate(input.context)
    : deps.template.render("note", input.context);
  return { outcome: "prepared", prepared: result.prepared, body };
}

export function composeLiteratureNote(
  deps: ComposeNoteDeps,
  input: ComposeNoteInput,
): ComposedNote | ComposeRefusal {
  const base = prepareLiteratureNote(deps, input);
  if (base.outcome === "refused") return base;
  const { prepared, body } = base;
  const frontmatter: Record<string, unknown> = {};
  applyComposedFrontmatter(deps, frontmatter, {
    context: input.context,
    itemKey: input.itemKey,
    profile: input.profile,
    prepared,
    onConflict: input.onConflict,
  });
  const frontmatterBlock =
    prepared.kind === "document"
      ? stringifyFrontmatterInOrder(frontmatter, prepared.keys)
      : stringifyYaml(frontmatter);
  return {
    outcome: "composed",
    prepared,
    frontmatter,
    frontmatterBlock,
    body,
    content: `---\n${frontmatterBlock}---\n${body}`,
  };
}

export function applyComposedFrontmatter(
  deps: {
    template: Pick<ComposeNoteDeps["template"], "frontmatterFields">;
    warn?: ComposeWarn;
    events?: ComposeNoteDeps["events"];
  },
  fm: Record<string, unknown>,
  input: ComposeFrontmatterInput,
): void {
  const { context, itemKey, profile, prepared } = input;
  const failed: string[] = [];
  const onConflict: FrontmatterMergeConflictHandler = (key, detail) => {
    deps.warn?.("Skipped frontmatter append", { key, itemKey, ...detail });
    input.onConflict?.(key, detail);
  };
  if (prepared.kind === "document") {
    applyDocumentManagedFrontmatter(fm, context, { prepared, onConflict });
  } else {
    applyManagedFrontmatter(fm, context, {
      compiled: deps.template.frontmatterFields,
      onError: (key, error) => {
        failed.push(key);
        deps.warn?.("Frontmatter expression failed", { key, itemKey, error });
      },
      onConflict,
    });
  }
  if (failed.length > 0) {
    deps.events?.emit("frontmatter-eval-failed", { itemKey, fields: failed });
  }
  if (profile.stamp === undefined) delete fm[FIELD_LITERATURE_NOTE_PROFILE];
  else fm[FIELD_LITERATURE_NOTE_PROFILE] = profile.stamp;
  if (profile.citationStyle == null) delete fm[FIELD_CITATION_STYLE];
  else fm[FIELD_CITATION_STYLE] = profile.citationStyle;
}
