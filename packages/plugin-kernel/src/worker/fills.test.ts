import { Temporal as TemporalPolyfill } from "temporal-polyfill/implementation";
import { describe, expect, it, vi } from "vitest";

import { fillMissing } from "./fills.ts";
import type { FillPieces, FillScope } from "./fills.ts";

function bareScope(): FillScope {
  return {
    Symbol: { for: Symbol.for } as unknown as SymbolConstructor,
    RegExp: {} as RegExpConstructor,
    Error: {} as ErrorConstructor,
    Map: {} as MapConstructor,
    Array: { prototype: {} } as ArrayConstructor,
  };
}

const piecesFor = (scope: FillScope): FillPieces => ({
  temporal: () => {
    scope.Temporal = TemporalPolyfill;
  },
});

describe("fillMissing", () => {
  it("keeps each global the runtime gives", async () => {
    const scope: FillScope = {
      Symbol,
      RegExp,
      Error,
      Map,
      Array,
      DisposableStack,
      AsyncDisposableStack,
      SuppressedError,
      Temporal,
    };
    const before = { ...scope };
    const escape: unknown = Reflect.get(RegExp, "escape");
    const dispose = Symbol.dispose;
    const temporal = vi.fn();
    await fillMissing(scope, { temporal });
    expect(temporal).not.toHaveBeenCalled();
    expect(scope).toStrictEqual(before);
    expect(Reflect.get(RegExp, "escape")).toBe(escape);
    expect(Symbol.dispose).toBe(dispose);
  });

  it("fills each global the runtime lacks", async () => {
    const scope = bareScope();
    await fillMissing(scope, piecesFor(scope));
    expect(scope.Symbol.dispose).toBe(Symbol.for("Symbol.dispose"));
    expect(scope.Symbol.asyncDispose).toBe(Symbol.for("Symbol.asyncDispose"));
    expect(typeof scope.RegExp.escape).toBe("function");
    expect(typeof scope.DisposableStack).toBe("function");
    expect(typeof scope.AsyncDisposableStack).toBe("function");
    expect(typeof scope.SuppressedError).toBe("function");
    expect(typeof Reflect.get(scope.Error, "captureStackTrace")).toBe(
      "function",
    );
    expect(scope.Temporal?.Instant.fromEpochMilliseconds(0).toString()).toBe(
      "1970-01-01T00:00:00Z",
    );
  });

  it("groups and sorts as the native Map.groupBy and Array.prototype.toSorted do", async () => {
    const scope = bareScope();
    await fillMissing(scope, piecesFor(scope));
    const words = ["beta", "alpha", "bravo", "apple"];
    const grouped = scope.Map.groupBy(words, (word, index) =>
      index < 0 ? "never" : word[0]!,
    );
    expect([...grouped]).toEqual([...Map.groupBy(words, (word) => word[0]!)]);
    const toSortedFill = Reflect.get(scope.Array.prototype, "toSorted") as (
      this: readonly string[],
      compare?: (a: string, b: string) => number,
    ) => string[];
    expect(toSortedFill.call(words)).toEqual(words.toSorted());
    expect(toSortedFill.call(words, (a, b) => b.localeCompare(a))).toEqual(
      words.toSorted((a, b) => b.localeCompare(a)),
    );
    const toReversedFill = Reflect.get(scope.Array.prototype, "toReversed") as (
      this: readonly string[],
    ) => string[];
    expect(toReversedFill.call(words)).toEqual(words.toReversed());
    expect(words).toEqual(["beta", "alpha", "bravo", "apple"]);
    const sparse: string[] = [];
    sparse[0] = "b";
    sparse[2] = "a";
    expect(Object.hasOwn(toSortedFill.call(sparse), 2)).toBe(true);
    expect(toSortedFill.call(sparse)).toEqual(sparse.toSorted());
    expect(Object.hasOwn(toReversedFill.call(sparse), 1)).toBe(true);
    expect(toReversedFill.call(sparse)).toEqual(sparse.toReversed());
  });

  it("tells an error from another value as the native Error.isError does", async () => {
    const scope = bareScope();
    await fillMissing(scope, piecesFor(scope));
    const isErrorFill = Reflect.get(scope.Error, "isError") as (
      value: unknown,
    ) => boolean;
    for (const value of [
      new Error("x"),
      new TypeError("x"),
      new (class extends Error {})("x"),
      new DOMException("x", "AbortError"),
      { message: "x" },
      { [Symbol.toStringTag]: "Error" },
      Object.create(Error.prototype),
      "x",
      null,
    ]) {
      expect(isErrorFill(value)).toBe(Error.isError(value));
    }
  });

  it("escapes a pattern as the native RegExp.escape does", async () => {
    const scope = bareScope();
    await fillMissing(scope, piecesFor(scope));
    for (const text of [
      "foo-bar.baz",
      "1+1=2?",
      "(a|b)[c]{d}^$\\/",
      ",-=<>#&!%:;@~'`\"",
      " tab\t newline\n \u2028 \uFEFF é",
      "_x9",
    ]) {
      expect(scope.RegExp.escape(text)).toBe(RegExp.escape(text));
    }
  });

  it("disposes a filled DisposableStack in reverse order and keeps every error", async () => {
    const scope = bareScope();
    await fillMissing(scope, piecesFor(scope));
    const order: string[] = [];
    const stack = new scope.DisposableStack!();
    stack.defer(() => order.push("first"));
    stack.use({
      [scope.Symbol.dispose]: () => {
        order.push("used");
        throw new Error("used failed");
      },
    });
    stack.adopt("value", () => {
      order.push("adopted");
      throw new Error("adopted failed");
    });
    const moved = stack.move();
    expect(stack.disposed).toBe(true);
    let thrown: unknown;
    try {
      moved.dispose();
    } catch (error) {
      thrown = error;
    }
    expect(order).toEqual(["adopted", "used", "first"]);
    expect(thrown).toBeInstanceOf(scope.SuppressedError!);
    const suppressed = thrown as SuppressedError;
    expect((suppressed.error as Error).message).toBe("used failed");
    expect((suppressed.suppressed as Error).message).toBe("adopted failed");
    expect(moved.disposed).toBe(true);
    expect(() => moved.defer(() => {})).toThrow(ReferenceError);
  });

  it("awaits each disposer of a filled AsyncDisposableStack", async () => {
    const scope = bareScope();
    await fillMissing(scope, piecesFor(scope));
    const order: string[] = [];
    const stack = new scope.AsyncDisposableStack!();
    stack.defer(async () => {
      await Promise.resolve();
      order.push("deferred");
    });
    stack.use({
      [scope.Symbol.asyncDispose]: async () => {
        order.push("async used");
      },
    });
    await stack.disposeAsync();
    expect(order).toEqual(["async used", "deferred"]);
    expect(stack.disposed).toBe(true);
  });
});
