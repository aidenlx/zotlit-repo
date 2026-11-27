import type { Context, Scope } from "effect";
import { Effect, Layer } from "effect";
import type { WorkspaceLeaf } from "obsidian";

import { reportOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import type { PluginHostShape } from "@zotlit/obsidian-kit/plugin-host.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { Template } from "./service.ts";
import { TemplateWorkbenchLauncher } from "./workbench-launcher.ts";

type CitationTemplateServices = Template | Notifier | TemplateWorkbenchLauncher;

export const layerCitationTemplateActions: Layer.Layer<
  never,
  never,
  PluginHost | CitationTemplateServices
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const context = yield* Effect.context<CitationTemplateServices>();
    const bridge = yield* scopedBridge;
    yield* addCitationTemplateActions(host, { context, bridge });
  }),
);

export function addCitationTemplateActions(
  host: Pick<PluginHostShape, "addCommand">,
  deps: {
    context: Context.Context<CitationTemplateServices>;
    bridge: Pick<EffectBridge, "runAndForget">;
  },
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(
    host.addCommand({
      id: "customize-citation-text",
      name: m.command_customize_citation_text_name(),
      callback: () =>
        deps.bridge.runAndForget(
          reportCitationTemplateOpen().pipe(
            Effect.provideContext(deps.context),
          ),
        ),
    }),
  );
}

export const openCitationTemplate = (from?: WorkspaceLeaf) =>
  Effect.gen(function* () {
    const file = yield* (yield* Template).materializeCitationTemplate;
    yield* (yield* TemplateWorkbenchLauncher).open(
      file,
      from ? { from: { leaf: from, place: "tab" } } : {},
    );
  }).pipe(Effect.withSpan("openCitationTemplate"));

export const reportCitationTemplateOpen = (from?: WorkspaceLeaf) =>
  reportOutcome(openCitationTemplate(from), {
    success: () => undefined,
    error: () => m.notice_citation_text_open_failed(),
  }).pipe(
    withLogCategory("template", "actions"),
    Effect.withSpan("CitationTemplate.reportOpen"),
  );
