import type { App, Workspace } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { noticeContentOf } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { noticeText } from "@zotlit/obsidian-kit/notice.ts";
// @vitest-environment happy-dom
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { MissingTemplateError } from "@zotlit/templates/facade";

import { missingPartialNotice } from "./workbench-recovery.ts";

import { MissingPartialError } from "#core/template/errors.ts";

function makeApp(): { app: App; trigger: ReturnType<typeof vi.fn> } {
  const trigger = vi.fn();
  return {
    app: stubService<App>("App", {
      workspace: stubService<Workspace>("Workspace", { trigger }),
    }),
    trigger,
  };
}

describe("missingPartialNotice", () => {
  it("names the missing partial as a plain string when no app is given", () => {
    const error = new MissingTemplateError("venue-line");

    expect(missingPartialNotice(error)).toBe(
      m.notice_note_missing_partial({ name: "venue-line" }),
    );
  });

  it("names the missing partial and offers the Template Workbench action when given an app", () => {
    const { app, trigger } = makeApp();
    const error = new MissingTemplateError("venue-line");

    const notice = noticeContentOf(missingPartialNotice(error, { app }));
    expect(noticeText(notice)).toContain("venue-line");

    const [action] = notice.actions ?? [];
    expect(action?.label).toBe(m.template_workbench_open_layout());

    action?.run();
    expect(trigger).toHaveBeenCalledExactlyOnceWith(
      "zotlit:open-template-workbench",
      expect.objectContaining({
        problem: expect.objectContaining({
          diagnostic: expect.objectContaining({
            code: "missing-partial",
            params: { name: "venue-line" },
          }),
        }),
      }),
    );
  });

  it("routes the action to the document whose call named the missing partial", () => {
    const { app, trigger } = makeApp();
    const error = new MissingPartialError(
      "templates/zotlit-profile.reading.md",
      "venue-line",
      new Error("Template not found"),
    );

    const [action] =
      noticeContentOf(missingPartialNotice(error, { app })).actions ?? [];
    action?.run();

    expect(trigger).toHaveBeenCalledExactlyOnceWith(
      "zotlit:open-template-workbench",
      {
        document: "templates/zotlit-profile.reading.md",
        problem: expect.objectContaining({
          diagnostic: expect.objectContaining({
            code: "missing-partial",
            params: { name: "venue-line" },
          }),
        }),
      },
    );
  });

  it("carries refused engine evidence in the Workbench arrival", () => {
    const { app, trigger } = makeApp();
    const error = new MissingPartialError(
      "templates/zotlit-profile.reading.md",
      "venue-line",
      new Error("the note render refused this attempt"),
    );

    const [action] =
      noticeContentOf(missingPartialNotice(error, { app })).actions ?? [];
    action?.run();

    const request = trigger.mock.calls[0]?.[1] as {
      problem: {
        diagnostic: {
          evidence?: { message?: string; causes?: readonly string[] };
          report?: {
            evidence?: { message?: string; causes?: readonly string[] };
          };
        };
      };
    };
    expect(request.problem.diagnostic.evidence).toMatchObject({
      message: 'Template "venue-line" not found',
      causes: ["the note render refused this attempt"],
    });
    expect(request.problem.diagnostic.report).toMatchObject({
      code: "missing-partial",
      evidence: {
        message: 'Template "venue-line" not found',
        causes: ["the note render refused this attempt"],
      },
      context: { document: "templates/zotlit-profile.reading.md" },
    });
  });

  it("returns undefined for every other failure, which the caller words itself", () => {
    expect(missingPartialNotice(new Error("boom"))).toBeUndefined();
  });
});
