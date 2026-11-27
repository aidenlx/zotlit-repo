import { addDuration } from "./filter-dates.ts";
import { errorValue, firstError, isError } from "./filter-error.ts";
import { finite, invoke, methodOf, propertyOf } from "./filter-functions.ts";
import type { FilterNode } from "./filter-plan.ts";
import type { FilterValue } from "./filter-values.ts";
import {
  compare,
  equals,
  isDate,
  isDuration,
  isList,
  toText,
  truthy,
  typeOf,
} from "./filter-values.ts";
import type { QueryClock } from "./query-clock.ts";

type Bindings = ReadonlyMap<string, FilterValue>;

interface Context<Item> {
  readonly item: Item;
  readonly clock: QueryClock;
  readonly bindings: Bindings;
}

export function matches<Item>(
  root: FilterNode<Item>,
  item: Item,
  clock: QueryClock,
): boolean {
  return truthy(evaluate(root, item, clock));
}

export function evaluate<Item>(
  node: FilterNode<Item>,
  item: Item,
  clock: QueryClock,
): FilterValue {
  return valueOf(node, { item, clock, bindings: new Map() });
}

const formulaValues = new WeakMap<
  object,
  Map<
    FilterNode<any>,
    { readonly clock: QueryClock; readonly value: FilterValue }
  >
>();

export function evaluateFormula<Item>(
  root: FilterNode<Item>,
  item: Item,
  clock: QueryClock,
): FilterValue {
  if (typeof item !== "object" || item === null)
    return evaluate(root, item, clock);
  let values = formulaValues.get(item);
  if (!values) formulaValues.set(item, (values = new Map()));
  const known = values.get(root);
  if (known?.clock === clock) return known.value;
  const value = evaluate(root, item, clock);
  values.set(root, { clock, value });
  return value;
}

function valueOf<Item>(
  node: FilterNode<Item>,
  context: Context<Item>,
): FilterValue {
  const { item, clock, bindings } = context;
  const value = (child: FilterNode<Item>) => valueOf(child, context);
  switch (node.kind) {
    case "literal":
      return node.value;
    case "list":
      return node.elements.map(value);
    case "field":
    case "custom-field":
      return node.value.read(item);
    case "binding":
      return bindings.get(node.name) ?? null;
    case "formula":
      return evaluateFormula(node.root, item, clock);
    case "unary": {
      const operand = value(node.operand);
      if (node.operator === "!") return !truthy(operand);
      if (operand === null || isError(operand)) return operand;
      return typeof operand === "number"
        ? -operand
        : errorValue({
            code: "wrong-operand-type",
            operator: "-",
            found: [typeOf(operand)],
          });
    }
    case "binary":
      return binary(node, context);
    case "if": {
      if (truthy(value(node.condition))) return value(node.whenTrue);
      return node.whenFalse ? value(node.whenFalse) : null;
    }
    case "function":
      return invoke(
        node.definition,
        { name: node.name, subject: null, args: node.args.map(value) },
        clock,
      );
    case "method": {
      if (node.membership) {
        return invoke(
          node.membership,
          { name: node.name, subject: null, args: node.args.map(value) },
          clock,
        );
      }
      const subject = value(node.subject);
      const method = methodOf(typeOf(subject), node.name);
      if (!method) return wrongSubject(subject, `${node.name}()`);
      return invoke(
        method,
        { name: node.name, subject, args: node.args.map(value) },
        clock,
      );
    }
    case "element":
      return element(node, context);
    case "property": {
      const subject = value(node.subject);
      if (isError(subject)) return subject;
      if (node.read) return node.read(subject);
      const property = propertyOf(typeOf(subject), node.name);
      return property
        ? property.read(subject, clock)
        : wrongSubject(subject, node.name);
    }
    case "index": {
      const subject = value(node.subject);
      const index = value(node.index);
      if (isError(subject)) return subject;
      if (isError(index)) return index;
      if (subject === null || index === null) return null;
      if (!isList(subject) && typeof subject !== "string") {
        return wrongSubject(subject, "index access");
      }
      if (typeof index !== "number" || !Number.isInteger(index)) {
        return errorValue({
          code: "invalid-index",
          found:
            typeof index === "string" ? JSON.stringify(index) : toText(index),
        });
      }
      return subject[index < 0 ? index + subject.length : index] ?? null;
    }
  }
}

function wrongSubject(subject: FilterValue, callee: string): FilterValue {
  if (subject === null || isError(subject)) return subject;
  return errorValue({
    code: "wrong-subject-type",
    callee,
    found: typeOf(subject),
  });
}

function element<Item>(
  node: Extract<FilterNode<Item>, { kind: "element" }>,
  context: Context<Item>,
): FilterValue {
  const subject = valueOf(node.subject, context);
  if (!isList(subject)) return wrongSubject(subject, `${node.name}()`);
  const args = node.args.map((arg) => valueOf(arg, context));
  const failed = firstError(args);
  if (failed !== undefined) return failed;
  const at = (index: number, acc?: FilterValue): FilterValue =>
    valueOf(node.expression, {
      ...context,
      bindings: new Map([
        ...context.bindings,
        ["value", subject[index]!],
        ["index", index],
        ...(acc === undefined ? [] : [["acc", acc] as const]),
      ]),
    });
  switch (node.name) {
    case "filter":
      return subject.filter((_element, index) => truthy(at(index)));
    case "map":
      return subject.map((_element, index) => at(index));
    case "reduce":
      return subject.reduce<FilterValue>(
        (acc, _element, index) => at(index, acc),
        args[0] ?? null,
      );
    default:
      return null;
  }
}

function shifted(date: FilterValue, operator: string): FilterValue {
  return date ?? errorValue({ code: "date-out-of-range", operator });
}

function binary<Item>(
  node: Extract<FilterNode<Item>, { kind: "binary" }>,
  context: Context<Item>,
): FilterValue {
  const { operator } = node;
  const { clock } = context;
  const value = (child: FilterNode<Item>) => valueOf(child, context);
  if (operator === "&&") {
    return truthy(value(node.left)) && truthy(value(node.right));
  }
  if (operator === "||") {
    return truthy(value(node.left)) || truthy(value(node.right));
  }
  const left = value(node.left);
  const right = value(node.right);
  if (operator === "==") return equals(left, right, clock);
  if (operator === "!=") return !equals(left, right, clock);
  if (isError(left)) return left;
  if (isError(right)) return right;
  switch (operator) {
    case "<":
    case "<=":
    case ">":
    case ">=":
      return compare(operator, [left, right], clock);
    case "+":
      if (typeof left === "string" || typeof right === "string") {
        return (
          (left === null ? "" : toText(left)) +
          (right === null ? "" : toText(right))
        );
      }
      if (isList(left) && isList(right)) return [...left, ...right];
      if (isDate(left) && isDuration(right)) {
        return shifted(addDuration(left, right.duration, clock), operator);
      }
      if (isDuration(left) && isDate(right)) {
        return shifted(addDuration(right, left.duration, clock), operator);
      }
      break;
    case "-":
      if (isDate(left) && isDuration(right)) {
        return shifted(
          addDuration(left, right.duration.negated(), clock),
          operator,
        );
      }
      break;
  }
  if (left === null || right === null) return null;
  if (typeof left !== "number" || typeof right !== "number") {
    return errorValue({
      code: "wrong-operand-type",
      operator,
      found: [typeOf(left), typeOf(right)],
    });
  }
  switch (operator) {
    case "+":
      return finite(left + right, operator);
    case "-":
      return finite(left - right, operator);
    case "*":
      return finite(left * right, operator);
    case "/":
      return finite(left / right, operator);
    case "%":
      return finite(left % right, operator);
  }
}
