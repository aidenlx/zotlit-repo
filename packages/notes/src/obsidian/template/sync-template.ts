import type { ProfileOperationError } from "#obsidian/profile/service.ts";
import { Cause, Effect, Exit, Result } from "effect";

import type { CompiledFrontmatterField } from "@zotlit/templates/frontmatter";

import type { TemplateFailure, TemplateOperations } from "./service.ts";
import { Template } from "./service.ts";

import { plainTemplateError } from "#core/template/errors.ts";

export const templateCall = <A, R>(
  effect: Effect.Effect<A, TemplateFailure, R>,
): Effect.Effect<A, unknown, R> =>
  Effect.mapError(effect, (error) => plainTemplateError(error));

export const profileCall = <A, R>(
  effect: Effect.Effect<A, ProfileOperationError, R>,
): Effect.Effect<A, unknown, R> =>
  effect.pipe(
    Effect.catchTag("ProfileOperationError", (error) =>
      Effect.fail(error.cause),
    ),
  );

export const syncTemplate: Effect.Effect<
  Pick<
    TemplateOperations,
    | "render"
    | "renderManagedContent"
    | "renderCitation"
    | "renderProfileAnnotation"
    | "frontmatterFields"
  >,
  never,
  Template
> = Effect.gen(function* () {
  const template = yield* Template;
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  const read = <A>(effect: Effect.Effect<A, TemplateFailure>): A => {
    const exit = runSync(Effect.exit(effect));
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.findError(exit.cause);
    throw Result.isSuccess(failure)
      ? plainTemplateError(failure.success)
      : Cause.squash(exit.cause);
  };
  return {
    render: (name, data) => read(template.render(name, data)),
    renderManagedContent: (data) => read(template.renderManagedContent(data)),
    renderCitation: (refs, variant) =>
      read(template.renderCitation(refs, variant)),
    renderProfileAnnotation: (data, options) =>
      read(template.renderProfileAnnotation(data, options)),
    get frontmatterFields(): readonly CompiledFrontmatterField[] {
      return read(template.frontmatterFields);
    },
  };
});
