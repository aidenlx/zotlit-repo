// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { isEditGesture } from "./capability-affordance.ts";

it("reads the reader's edit keystrokes, and nothing else, as edit gestures", () => {
  const gesture = (init: KeyboardEventInit, target?: HTMLElement): boolean => {
    const event = new KeyboardEvent("keydown", init);
    if (target) target.dispatchEvent(event);
    return isEditGesture(event);
  };

  expect(["h", "u", "c", "1", "8", "H"].map((key) => gesture({ key }))).toEqual(
    [true, true, true, true, true, true],
  );
  expect(["9", "0", "x", "Escape"].map((key) => gesture({ key }))).toEqual([
    false,
    false,
    false,
    false,
  ]);
  expect(gesture({ key: "h", ctrlKey: true })).toBe(false);
  expect(gesture({ key: "h", metaKey: true })).toBe(false);
  expect(gesture({ key: "h", altKey: true })).toBe(false);

  const field = document.createElement("input");
  document.body.append(field);
  expect(gesture({ key: "h", bubbles: true }, field)).toBe(false);
  field.remove();
});
