import { expect, it } from "vitest";

import { themeAttribute, themeHook } from "./theme-hooks.ts";

it("promises the Annotation View hooks by literal name", () => {
  expect({
    conflict: themeHook.annotConflict,
    draft: themeHook.annotDraft,
    commentField: themeHook.annotCommentField,
    lock: themeHook.annotLock,
  }).toEqual({
    conflict: "zt-annot-conflict",
    draft: "zt-annot-draft",
    commentField: "zt-annot-comment-field",
    lock: "zt-annot-lock",
  });
});

it("promises the Chooser hooks by literal name", () => {
  expect({
    popup: themeHook.chooser,
    trigger: themeHook.chooserTrigger,
  }).toEqual({
    popup: "zt-chooser",
    trigger: "zt-chooser-trigger",
  });
});

it("promises the Query View toolbar button hook by literal name", () => {
  expect({ button: themeHook.queryToolbarButton }).toEqual({
    button: "zt-query-toolbar-button",
  });
});

it("promises the PDF reader's mode attributes by literal name", () => {
  expect({ inking: themeAttribute.pdfInking }).toEqual({
    inking: "data-zt-inking",
  });
});

it("promises the Text Draft hook by literal name", () => {
  expect({ textDraft: themeHook.pdfTextDraft }).toEqual({
    textDraft: "zt-pdf-text-draft",
  });
});

it("promises the regular expression hook of the template editors by literal name", () => {
  expect({ regexp: themeHook.templateRegexp }).toEqual({
    regexp: "zt-template-regexp",
  });
});
