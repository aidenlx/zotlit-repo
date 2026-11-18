import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { describe, expect } from "vitest";

import { forkEach } from "@/lib/effect-stream.ts";
import { settingsOf } from "@/services/settings/__fixtures__.ts";
import type { Settings } from "@/services/settings/schema.ts";

import { WikilinkDisplaySettings } from "./wikilink-display-settings.ts";

/** Lets a Stream consumer take what was just published. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 5; turn++) yield* Effect.yieldNow;
});

/**
 * A display that follows the real settings, seeded with `overrides` before it
 * starts, and counts the redraws it asks for until the test Scope closes.
 */
const following = Effect.fnUntraced(function* (
  overrides: Partial<Settings> = {},
) {
  const settings = yield* settingsOf({
    plugin: {
      loadData: () => Promise.resolve(null),
      saveData: () => Promise.resolve(),
    },
  });
  yield* settings.update(overrides);
  const display = new WikilinkDisplaySettings();
  let redraws = 0;
  const fiber = yield* forkEach(display.redraws(settings.changes), () => {
    redraws++;
  });
  yield* settle;
  return {
    display,
    redraws: () => redraws,
    stop: Fiber.interrupt(fiber),
    update: (next: Partial<Settings>) =>
      Effect.andThen(settings.update(next), settle),
  };
});

describe("WikilinkDisplaySettings", () => {
  it.effect("seeds from the first snapshot without asking for a redraw", () =>
    Effect.gen(function* () {
      const { display, redraws } = yield* following({
        "citation.wikilink-citations": true,
      });

      expect(display.enabled).toBe(true);
      expect(redraws()).toBe(0);
    }),
  );

  it.effect(
    "shows wikilinks only while their source and formatted presentation are on",
    () =>
      Effect.gen(function* () {
        const { display, update } = yield* following({
          "citation.wikilink-citations": true,
          "citation.show-formatted": true,
        });

        yield* update({ "citation.show-formatted": false });
        expect(display.enabled).toBe(false);

        yield* update({
          "citation.show-formatted": true,
          "citation.wikilink-citations": false,
        });
        expect(display.enabled).toBe(false);
      }),
  );

  it.effect(
    "asks for a redraw when a later snapshot changes what a link displays",
    () =>
      Effect.gen(function* () {
        const { redraws, update } = yield* following({
          "citation.wikilink-citations": false,
        });

        yield* update({ "citation.wikilink-citations": true });
        expect(redraws()).toBe(1);

        yield* update({ "citation.show-formatted": false });
        expect(redraws()).toBe(2);
      }),
  );

  it.effect("stays quiet for a setting neither surface reads", () =>
    Effect.gen(function* () {
      const { redraws, update } = yield* following();

      yield* update({ "citation.pandoc-citations": false });
      expect(redraws()).toBe(0);
    }),
  );

  it.effect("takes the click while Citations stay closed as links", () =>
    Effect.gen(function* () {
      const { display, redraws, update } = yield* following({
        "citation.open-as-links": true,
      });
      expect(display.clickIntercepted).toBe(false);

      yield* update({ "citation.open-as-links": false });

      expect(display.clickIntercepted).toBe(true);
      expect(redraws()).toBe(1);
    }),
  );

  it.effect("reads the click apart from the Hover Action", () =>
    Effect.gen(function* () {
      const { display } = yield* following({
        "citation.hover-action": "off",
      });

      expect(display.popoverHover).toBe(false);
      expect(display.clickIntercepted).toBe(true);
    }),
  );

  it.effect("stops following once its consumer is interrupted", () =>
    Effect.gen(function* () {
      const { display, redraws, stop, update } = yield* following();

      yield* stop;
      yield* update({ "citation.wikilink-citations": true });

      expect(display.enabled).toBe(false);
      expect(redraws()).toBe(0);
    }),
  );
});
