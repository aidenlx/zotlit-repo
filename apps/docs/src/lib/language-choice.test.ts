// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHINESE_READER_ATTR,
  LANGUAGE_CHOICE_KEY,
  chineseReaderScript,
  rememberLanguageChoice,
} from "./language-choice.ts";

function runHeadScript(languages: string[]) {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
  // oxlint-disable-next-line typescript/no-implied-eval -- the script ships as an inline <script> string; this runs that exact string.
  new Function(chineseReaderScript)();
  return document.documentElement.hasAttribute(CHINESE_READER_ATTR);
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute(CHINESE_READER_ATTR);
});

describe("chineseReaderScript", () => {
  it.each([
    [["zh"], true],
    [["zh-TW", "en"], true],
    [["en-US", "zh-CN"], false],
    [["zhx"], false],
  ])("marks %j: %s", (languages, marked) => {
    expect(runHeadScript(languages)).toBe(marked);
  });

  it("respects a reader who chose English", () => {
    localStorage.setItem(LANGUAGE_CHOICE_KEY, "en");
    expect(runHeadScript(["zh-CN"])).toBe(false);
  });

  it("marks a Chinese reader when the storage read is blocked", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    expect(runHeadScript(["zh-TW"])).toBe(true);
  });
});

it("dismisses the suggestion for this page when saving English is blocked", () => {
  document.documentElement.setAttribute(CHINESE_READER_ATTR, "");
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Storage blocked", "SecurityError");
  });

  rememberLanguageChoice("en");

  expect(document.documentElement.hasAttribute(CHINESE_READER_ATTR)).toBe(
    false,
  );
});
