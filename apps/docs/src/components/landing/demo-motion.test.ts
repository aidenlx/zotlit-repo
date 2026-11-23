import { expect, it } from "vitest";

import { demoMotion } from "./demo-motion.ts";
import type { DemoInputs, DemoMotion } from "./demo-motion.ts";

const idle: DemoInputs = {
  wasEligible: false,
  visibleRatio: 0,
  reduced: false,
  paused: false,
  byReader: false,
};
const playing: DemoInputs = { ...idle, wasEligible: true, visibleRatio: 1 };

it.each<[string, DemoInputs, DemoMotion]>([
  [
    "asks for the turn from the collection once half of it is on screen",
    { ...idle, visibleRatio: 0.5 },
    { eligible: true, turn: "ask", frame: "collection" },
  ],
  [
    "takes the turn when the reader plays it on screen",
    { ...idle, visibleRatio: 1, byReader: true },
    { eligible: true, turn: "take" },
  ],
  [
    "keeps playing while it stays at least half on screen",
    { ...playing, visibleRatio: 0.8 },
    { eligible: true },
  ],
  [
    "ends its turn on the finished frame below half visibility",
    { ...playing, visibleRatio: 0.25 },
    { eligible: false, turn: "end", frame: "finished" },
  ],
  [
    "ends its turn and waits at the collection once off screen",
    { ...playing, visibleRatio: 0 },
    { eligible: false, turn: "end", frame: "collection" },
  ],
  [
    "ends its turn on the finished frame when motion is reduced",
    { ...playing, reduced: true },
    { eligible: false, turn: "end", frame: "finished" },
  ],
  [
    "shows the finished frame off screen under reduced motion",
    { ...idle, reduced: true },
    { eligible: false, frame: "finished" },
  ],
  [
    "ends its turn on the finished frame when the reader pauses it",
    { ...playing, paused: true, byReader: true },
    { eligible: false, turn: "end", frame: "finished" },
  ],
  [
    "shows the collection when the reader plays it below half visibility",
    { ...idle, visibleRatio: 0.25, byReader: true },
    { eligible: false, frame: "collection" },
  ],
  [
    "keeps its frame while it enters the screen below half visibility",
    { ...idle, visibleRatio: 0.25 },
    { eligible: false },
  ],
  [
    "keeps its frame before the first viewport report",
    { ...idle, visibleRatio: null },
    { eligible: false },
  ],
])("%s", (_, inputs, expected) => {
  expect(demoMotion(inputs)).toEqual(expected);
});
