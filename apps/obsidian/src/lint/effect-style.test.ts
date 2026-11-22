import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noTacit } from "../../../../packages/config/oxlint-plugin-effect-style.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const effect = 'import { Effect, Stream, Layer, Option } from "effect";\n';
const tacit = [{ messageId: "tacit" }];
const flow = [{ messageId: "flow" }];

tester.run("no-tacit", noTacit, {
  valid: [
    `${effect}effect.pipe(Effect.map((x) => fn(x)))`,
    `${effect}Effect.map(effect, (x) => fn(x))`,
    `${effect}Effect.forEach(items, (item, i) => save(item, i), { concurrency: 2 })`,
    `${effect}const options = { concurrency: 2 }; Effect.forEach(items, (item) => save(item), options)`,
    `${effect}const options = { concurrency: 2 }; Effect.forEach((item) => save(item), options)`,
    `${effect}import { options, save } from "./tasks"; Effect.forEach((item) => save(item), options)`,
    `${effect}import { makeOptions, save } from "./tasks"; Effect.forEach((item) => save(item), makeOptions())`,
    `${effect}import { makeOptions, save } from "./tasks"; const opts = makeOptions(); Effect.forEach(save, opts)`,
    `${effect}Stream.filter(service.changes, (event) => isReady(event))`,
    `${effect}effect.pipe(Effect.andThen(next))`,
    `${effect}effect.pipe(Effect.tap(log))`,
    `${effect}layer.pipe(Layer.provide(base))`,
    `${effect}Effect.map(effect, (x) => x + 1)`,
    `${effect}effect.pipe(Effect.catchTag("NotFound", () => Effect.void))`,
    `${effect}Effect.sync(compute)`,
    `${effect}Option.getOrElse(option, makeDefault)`,
    "items.map(format)",
    "Array.from(items).map(format)",
    'import type { Effect } from "effect";\nEffect.map(fn)',
    'import { Effect } from "./effect";\nEffect.map(fn)',
    "const Effect = { map: (f) => f };\nEffect.map(fn)",
    'import { pipe } from "effect";\npipe(x, (v) => f(v))',
    'import { flow } from "./flow";\nflow(f, g)',
  ],
  invalid: [
    {
      code: `${effect}effect.pipe(Effect.mapError(toDbUnavailable))`,
      errors: tacit,
    },
    { code: `${effect}fiber.pipe(Effect.flatMap(Fiber.join))`, errors: tacit },
    {
      code: `${effect}effect.pipe(Effect.flatMap(Effect.fail))`,
      errors: tacit,
    },
    {
      code: `${effect}effect.pipe(Effect.catchDefect(dieOfDefect))`,
      errors: tacit,
    },
    { code: `${effect}stream.pipe(Stream.runForEach(push))`, errors: tacit },
    { code: `${effect}stream.pipe(Stream.filter(Boolean))`, errors: tacit },
    { code: `${effect}Stream.filter(service.changes, isReady)`, errors: tacit },
    { code: `${effect}Effect.map(effect, this.format)`, errors: tacit },
    {
      code: `${effect}Effect.forEach(items, save, { concurrency: 2 })`,
      errors: tacit,
    },
    { code: `${effect}Effect.forEach(save, { discard: true })`, errors: tacit },
    {
      code: `${effect}const opts = { discard: true }; Effect.forEach(save, opts)`,
      errors: [{ messageId: "tacit", column: 47, endColumn: 51 }],
    },
    {
      code: `${effect}Effect.forEach(items, save, opts)`,
      errors: [{ messageId: "tacit", column: 22, endColumn: 26 }],
    },
    {
      code: `${effect}const save = (item) => Effect.succeed(item);\nEffect.forEach(items, save)`,
      errors: [{ messageId: "tacit", line: 3, column: 22, endColumn: 26 }],
    },
    {
      code: `${effect}import { save } from "./tasks";\nEffect.forEach([1, 2], save)`,
      errors: [{ messageId: "tacit", line: 3, column: 23, endColumn: 27 }],
    },
    {
      code: `${effect}import { save } from "./tasks";\nfunction each(options: { concurrency: number }) {\n  return Effect.forEach(save, options);\n}`,
      errors: [{ messageId: "tacit", line: 4, column: 24, endColumn: 28 }],
    },
    {
      code: `${effect}import { options } from "./options";\nfunction save(item) { return Effect.succeed(item); }\nEffect.forEach(save, options)`,
      errors: [{ messageId: "tacit", line: 4, column: 15, endColumn: 19 }],
    },
    {
      code: `${effect}import { makeOptions } from "./options";\nconst opts = makeOptions();\nfunction each(save: (item: number) => Effect.Effect<number>) {\n  return Effect.forEach(save, opts);\n}`,
      errors: [{ messageId: "tacit", line: 5, column: 24, endColumn: 28 }],
    },
    {
      code: `${effect}import { options, save } from "./tasks";\npipe(items, Effect.forEach(save, options))`,
      errors: [{ messageId: "tacit", line: 3, column: 27, endColumn: 31 }],
    },
    {
      code: `${effect}const options = (item) => Effect.succeed(item);\nEffect.forEach(items, options)`,
      errors: [{ messageId: "tacit", line: 3, column: 22, endColumn: 29 }],
    },
    {
      code: `${effect}const step = (total, next) => [total + next, [next]];\nStream.mapAccum(stream, () => 0, step)`,
      errors: [{ messageId: "tacit", line: 3, column: 33, endColumn: 37 }],
    },
    {
      code: `${effect}const opts = { discard: true } as const; Effect.forEach(save, opts)`,
      errors: [{ messageId: "tacit", column: 56, endColumn: 60 }],
    },
    {
      code: `${effect}effect.pipe(Effect.catchTag("NotFound", recover))`,
      errors: tacit,
    },
    { code: `${effect}Effect.promise(load)`, errors: tacit },
    {
      code: 'import { Array as Arr } from "effect";\nArr.map(items, format)',
      errors: tacit,
    },
    {
      code: 'import * as E from "effect/Effect";\neffect.pipe(E.map(format))',
      errors: tacit,
    },
    {
      code: 'import { flow } from "effect";\nconst g = flow(f, h)',
      errors: flow,
    },
    {
      code: 'import { flow as compose } from "effect/Function";\nconst g = compose(f, h)',
      errors: flow,
    },
    {
      code: 'import { Function } from "effect";\nconst g = Function.flow(f, h)',
      errors: flow,
    },
  ],
});
