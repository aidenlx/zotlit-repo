import {
  Data,
  Effect,
  Schema,
  SchemaAST,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import type { CliData } from "obsidian";

import { parseIndexedKey } from "@zotlit/zotero-types/keys";

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      readonly cliSwitch?: true | undefined;
      readonly cliMaybeEmpty?: true | undefined;
      readonly cliNotApplicable?: true | undefined;
      readonly cliAllowed?: readonly string[] | undefined;
    }
  }
}

export type CliParamsSchema = Schema.Top & {
  readonly Encoded: object;
  readonly DecodingServices: never;
};

type Variants = Readonly<Record<string, CliParamsSchema>>;

export interface CliVariantsSchema<TVariants extends Variants> {
  readonly variants: TVariants;
  readonly kindOf: (params: CliData) => keyof TVariants;
}

// oxlint-disable-next-line typescript/no-explicit-any -- any variant set.
type CliSchema = CliParamsSchema | CliVariantsSchema<any>;

export type CliOutput<TSchema extends CliSchema> =
  TSchema extends CliVariantsSchema<infer TVariants>
    ? TVariants[keyof TVariants]["Type"]
    : TSchema extends CliParamsSchema
      ? TSchema["Type"]
      : never;

type KeysOf<T> = T extends unknown ? keyof T : never;

export type CliParamName<TSchema extends CliSchema> = KeysOf<
  TSchema extends CliVariantsSchema<infer TVariants>
    ? TVariants[keyof TVariants]["Encoded"]
    : TSchema extends CliParamsSchema
      ? TSchema["Encoded"]
      : never
> &
  string;

interface CliIssue {
  readonly path: string;
  readonly span?: { readonly from: number; readonly to: number };
  readonly expected: string;
  readonly received: string;
  readonly keys?: readonly (string | number)[];
  readonly input?: unknown;
  readonly allowed?: readonly string[];
}

export class CliRejection extends Data.TaggedError("CliRejection")<{
  readonly parameter: string;
  readonly message: string;
  readonly issue?: CliIssue;
  readonly received?: readonly (readonly [string, string])[];
  readonly shellSplit?: boolean;
  readonly accepted?: readonly string[];
  readonly hint?: string;
}> {}

export function catchRejection(answer: (rejection: CliRejection) => string) {
  return <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A | string, Exclude<E, CliRejection>, R> =>
    effect.pipe(
      Effect.catch((error) =>
        error instanceof CliRejection
          ? Effect.succeed(answer(error))
          : Effect.fail(error as Exclude<E, CliRejection>),
      ),
    );
}

type RejectionFields = ConstructorParameters<typeof CliRejection>[0];

export function amendRejection(
  rejection: CliRejection,
  patch: Partial<RejectionFields>,
): CliRejection {
  const { parameter, message, issue, received, shellSplit, accepted, hint } =
    rejection;
  const fields = { issue, received, shellSplit, accepted, hint, ...patch };
  return new CliRejection({
    parameter,
    message,
    ...Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ),
  });
}

export function cliParams<const TFields extends Schema.Struct.Fields>(
  fields: TFields,
  missing: Partial<Record<keyof TFields, string>> = {},
): Schema.Struct<TFields> {
  const keyed = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      (field as Schema.Top).annotateKey({
        messageMissingKey: missing[name] ?? `${name} is required.`,
      }),
    ]),
  );
  return Schema.Struct(keyed as unknown as TFields);
}

export function cliMap<TFrom extends Schema.Top, TTo>(
  f: (value: TFrom["Type"]) => TTo,
) {
  return cliMapEffect<TFrom, TTo>((value) => Effect.succeed(f(value)));
}

export function cliMapEffect<TFrom extends Schema.Top, TTo>(
  f: (
    value: TFrom["Type"],
    options: SchemaAST.ParseOptions,
  ) => Effect.Effect<TTo, SchemaIssue.Issue>,
) {
  return (self: TFrom) =>
    self.pipe(
      Schema.decodeTo(
        Schema.declare(
          // oxlint-disable-next-line no-unused-vars -- The step's own output: nothing is left to check.
          (_value: unknown): _value is TTo => true,
        ),
        {
          decode: SchemaGetter.transformEffect((value, options) =>
            f(value, options),
          ),
          encode: SchemaGetter.forbidden(() => "CLI parameters only decode"),
        },
      ),
    );
}

export function cliRule<T>(
  parameter: string,
  holds: (input: T) => boolean,
  message: string | ((input: T) => string),
) {
  return Schema.makeFilter<T>((input) =>
    holds(input)
      ? undefined
      : {
          path: [parameter],
          issue: typeof message === "string" ? message : message(input),
        },
  );
}

export function cliIndexedKey(message: string | ((text: string) => string)) {
  return Schema.makeFilter((text: string) => {
    const parsed = parseIndexedKey(text);
    return (
      (parsed !== null && (parsed.groupID === null || parsed.groupID > 0)) ||
      (typeof message === "string" ? message : message(text))
    );
  });
}

export function cliNotApplicable(message: string) {
  return Schema.optionalKey(
    Schema.Never.annotate({ message, cliNotApplicable: true }),
  );
}

export function cliVariants<const TVariants extends Variants>(
  kindOf: (params: CliData) => keyof TVariants,
  variants: TVariants,
): CliVariantsSchema<TVariants> {
  return { kindOf, variants };
}

export function cliOneOf<TInput extends Readonly<Record<string, unknown>>>(
  names: readonly (keyof TInput & string)[],
  messages: { many: string; none?: string },
) {
  return Schema.makeFilter<TInput>((input) => {
    const given = names.filter((name) => input[name] !== undefined);
    if (given.length > 1) return { path: [given[1]!], issue: messages.many };
    if (given.length === 0 && messages.none !== undefined)
      return { path: [names[0]!], issue: messages.none };
    return undefined;
  });
}

export const noCliParams = cliParams({});

export function cliSwitch(message: string) {
  return Schema.optionalKey(
    Schema.String.check(
      Schema.makeFilter(
        (input: string) => input === "true" || input === "" || message,
        { cliAllowed: ["true", ""] },
      ),
    )
      .pipe(
        Schema.decodeTo(Schema.Literal(true), {
          decode: SchemaGetter.transform((): true => true),
          encode: SchemaGetter.transform(() => "true" as const),
        }),
      )
      .annotate({ cliSwitch: true }),
  );
}

export function cliMaybeEmpty() {
  return Schema.optionalKey(Schema.String.annotate({ cliMaybeEmpty: true }));
}

export function cliDefault<TSchema extends Schema.Top>(
  schema: TSchema,
  encoded: TSchema["Encoded"],
) {
  return schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(encoded)));
}

export function cliText(message: string) {
  return Schema.String.check(
    Schema.makeFilter((text: string) => text.trim() !== "" || message),
  );
}

export function cliValue(parameter: string) {
  return Schema.String.check(
    Schema.makeFilter(
      (value: string) => value !== "true" || `${parameter} requires a value.`,
    ),
  );
}

export function cliLiterals<const TValues extends readonly string[]>(
  values: TValues,
  message: string | ((input: string) => string) = (input) =>
    `Invalid type: Expected ${expectedOf(Schema.Literals(values).ast)} but received ${JSON.stringify(input)}`,
) {
  return Schema.String.check(
    Schema.makeFilter(
      (input: string) =>
        values.includes(input) ||
        (typeof message === "string" ? message : message(input)),
      { cliAllowed: values, expected: expectedOf(Schema.Literals(values).ast) },
    ),
  ).pipe(cliMap((input) => input as TValues[number]));
}

export function cliJson<TSchema extends Schema.Top>(
  message: string,
  schema: TSchema,
) {
  return Schema.String.pipe(
    cliMapEffect((text: string, options) => {
      try {
        return Effect.succeed(JSON.parse(text) as unknown);
      } catch {
        return Effect.fail(
          new SchemaIssue.InvalidValue(
            { message, expected: "JSON" },
            text,
            options,
          ),
        );
      }
    }),
    Schema.decodeTo(schema),
  );
}

export const expectSourceParam = Schema.optionalKey(cliValue("expect-source"));

export interface CliCommand {
  command: string;
  misplaced?: Readonly<Record<string, string>>;
}

export function decodeCliParams<TSchema extends CliSchema>(
  params: CliData,
  schema: TSchema,
  options: CliCommand,
): Effect.Effect<CliOutput<TSchema>, CliRejection> {
  return Effect.suspend(() => {
    const fields = fieldsOf(schema);
    const accepted = Object.keys(fields);
    const received = Object.entries(params);

    for (const key of Object.keys(params)) {
      if (accepted.includes(key)) continue;
      return Effect.fail(rejectToken(key, fields, { ...options, received }));
    }
    for (const key of Object.keys(params)) {
      if (params[key] === "" && !takesEmpty(fields[key])) {
        return Effect.fail(
          new CliRejection({
            parameter: key,
            message: `${key} requires a value.`,
          }),
        );
      }
    }

    const variant: CliParamsSchema = isVariants(schema)
      ? schema.variants[schema.kindOf(params)]!
      : (schema as CliParamsSchema);
    const decoded = Schema.decodeEffect(variant)(params, {
      errors: "first",
      reportInput: true,
    }) as Effect.Effect<CliOutput<TSchema>, Schema.SchemaError>;
    return decoded.pipe(
      Effect.catchTag("SchemaError", ({ issue }) => {
        const fault = firstFault(issue, []);
        const [parameter] = fault.path;
        if (typeof parameter !== "string") {
          return Effect.die(
            new Error(
              `The ${options.command} schema raised an issue without a parameter: ${fault.message}`,
            ),
          );
        }
        return Effect.fail(
          new CliRejection({
            parameter,
            message: fault.message,
            issue: {
              path: issuePath(fault.path),
              expected: fault.expected,
              received: fault.received,
              keys: fault.path
                .slice(1)
                .map((key) => (typeof key === "number" ? key : String(key))),
              input: fault.input,
              ...(fault.allowed === undefined
                ? {}
                : { allowed: fault.allowed }),
            },
            received,
          }),
        );
      }),
      Effect.tap(() => {
        const own = Object.keys(structFields(variant));
        const stray = Object.keys(params).find((key) => !own.includes(key));
        return stray === undefined
          ? Effect.void
          : Effect.fail(
              new CliRejection({
                parameter: stray,
                message: `${stray} does not apply with the other parameters given.`,
                issue: {
                  path: stray,
                  expected: "never",
                  received: receivedText(params[stray]),
                  keys: [],
                  input: params[stray],
                },
                received,
              }),
            );
      }),
    );
  });
}

function isVariants(schema: CliSchema): schema is CliVariantsSchema<Variants> {
  return "variants" in schema && "kindOf" in schema;
}

interface Fault {
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly expected: string;
  readonly received: string;
  readonly input: unknown;
  readonly allowed?: readonly string[];
}

function firstFault(
  issue: SchemaIssue.Issue,
  path: readonly PropertyKey[],
  check?: SchemaIssue.Filter,
): Fault {
  switch (issue._tag) {
    case "Pointer":
      return firstFault(issue.issue, [...path, ...issue.path], check);
    case "Composite":
      return firstFault(issue.issues[0], path, check);
    case "Encoding":
      return firstFault(issue.issue, path, check);
    case "Filter":
      return firstFault(issue.issue, path, issue);
    case "AnyOf":
      if (issue.issues.length > 0)
        return firstFault(issue.issues[0]!, path, check);
      break;
    default:
      break;
  }
  const input = SchemaIssue.hasInput(issue)
    ? issue.input
    : check && SchemaIssue.hasInput(check)
      ? check.input
      : undefined;
  const annotations = check?.filter.annotations;
  const allowed = annotations?.cliAllowed;
  const leaf = leafFault(issue, path, input);
  const message =
    (check && SchemaIssue.defaultCheckHook(check)) ?? leaf.message;
  return {
    path,
    message,
    expected: annotations?.expected ?? (check ? message : leaf.expected),
    received: leaf.received,
    input,
    ...(allowed === undefined ? {} : { allowed }),
  };
}

function leafFault(
  issue: SchemaIssue.Issue,
  path: readonly PropertyKey[],
  input: unknown,
): { message: string; expected: string; received: string } {
  const key = JSON.stringify(String(path.at(-1)));
  switch (issue._tag) {
    case "InvalidType":
    case "AnyOf": {
      const expected = expectedOf(issue.ast);
      const received = receivedText(input);
      return {
        message:
          messageOf(SchemaAST.resolve(issue.ast)) ??
          `Invalid type: Expected ${expected} but received ${received}`,
        expected,
        received,
      };
    }
    case "MissingKey":
      return {
        message:
          issue.annotations?.messageMissingKey ??
          `Invalid key: Expected ${key} but received undefined`,
        expected: key,
        received: "undefined",
      };
    case "UnexpectedKey":
      return {
        message: `Invalid key: Expected never but received ${key}`,
        expected: "never",
        received: key,
      };
    case "InvalidValue": {
      const message = SchemaIssue.defaultLeafHook(issue);
      return {
        message,
        expected: issue.annotations?.expected ?? message,
        received: receivedText(input),
      };
    }
    default: {
      const message = SchemaIssue.defaultLeafHook(issue as SchemaIssue.Leaf);
      return { message, expected: message, received: receivedText(input) };
    }
  }
}

function messageOf(
  annotations: Schema.Annotations.Annotations | undefined,
): string | undefined {
  const message = annotations?.message;
  return typeof message === "string" ? message : undefined;
}

function expectedOf(ast: SchemaAST.AST): string {
  switch (ast._tag) {
    case "Literal":
      return JSON.stringify(ast.literal);
    case "Union":
      return `(${ast.types.map(expectedOf).join(" | ")})`;
    case "Objects":
      return "Object";
    case "Arrays":
      return "Array";
    default:
      return ast._tag.toLowerCase();
  }
}

function receivedText(input: unknown): string {
  if (typeof input === "string") return JSON.stringify(input);
  if (input === null || typeof input !== "object") return String(input);
  return Array.isArray(input) ? "Array" : "Object";
}

function issuePath(path: readonly PropertyKey[]): string {
  let formatted = "";
  for (const key of path) {
    formatted +=
      typeof key === "number"
        ? `[${key}]`
        : formatted === ""
          ? String(key)
          : `.${String(key)}`;
  }
  return formatted;
}

type Field = Schema.Top;

function fieldsOf(schema: CliSchema): Readonly<Record<string, Field>> {
  const structs = isVariants(schema)
    ? Object.values(schema.variants)
    : [schema];
  const fields: Record<string, Field> = {};
  for (const struct of structs) {
    for (const [name, field] of Object.entries(structFields(struct))) {
      if (!fields[name] || isNotApplicable(fields[name])) fields[name] = field;
    }
  }
  return fields;
}

function structFields(schema: unknown): Readonly<Record<string, Field>> {
  let node = schema as { fields?: Schema.Struct.Fields; from?: unknown };
  while (node.fields === undefined) {
    if (node.from === undefined)
      throw new Error("A CLI parameters schema decodes from no cliParams");
    node = node.from as typeof node;
  }
  return node.fields as Readonly<Record<string, Field>>;
}

function annotationsOf(field: Field | undefined) {
  return field === undefined ? undefined : SchemaAST.resolve(field.ast);
}

function isSwitch(field: Field | undefined): boolean {
  return annotationsOf(field)?.cliSwitch === true;
}

function isNotApplicable(field: Field): boolean {
  return annotationsOf(field)?.cliNotApplicable === true;
}

function takesEmpty(field: Field | undefined): boolean {
  return isSwitch(field) || annotationsOf(field)?.cliMaybeEmpty === true;
}

export function rejectionText(rejection: CliRejection): string {
  return rejection.hint === undefined
    ? rejection.message
    : `${rejection.message} ${rejection.hint}`;
}

function rejectToken(
  key: string,
  fields: Readonly<Record<string, Field>>,
  options: CliCommand & { received: readonly (readonly [string, string])[] },
): CliRejection {
  const { command, received } = options;
  const accepted = Object.keys(fields);
  if (key === "vault")
    return new CliRejection({
      parameter: "vault",
      message: VAULT_AFTER_COMMAND_MESSAGE,
    });
  if (key.startsWith("--")) {
    const parameter = key.slice(2);
    if (accepted.includes(parameter)) {
      const form = isSwitch(fields[parameter])
        ? parameter
        : `${parameter}=<value>`;
      return new CliRejection({
        parameter: key,
        message: `Parameter '${key}' is not valid: use ${form}.`,
        hint: `Run the command with ${form}, without --.`,
      });
    }
    return new CliRejection({
      parameter: key,
      message: unknownMessage(key, accepted, command),
      hint:
        accepted.length === 0
          ? `Remove '${key}'; ${command} takes no parameters.`
          : "Use a supported parameter as name=value, without --; see the command help for its parameters.",
    });
  }
  if (
    SHELL_SPLIT_INITIALS.has(key[0] ?? "") ||
    (key === "" &&
      received.some(([name, value]) => name === key && value.startsWith("=")))
  ) {
    return new CliRejection({
      parameter: key,
      message: `Unknown parameter '${key}': Obsidian received these parameters in order: ${received.map(([name]) => name || '""').join(", ")}.`,
      hint: "Quote the whole value as one shell argument.",
      received,
      shellSplit: true,
      accepted,
    });
  }
  return new CliRejection({
    parameter: key,
    message: options.misplaced?.[key] ?? unknownMessage(key, accepted, command),
  });
}

function unknownMessage(
  key: string,
  accepted: readonly string[],
  command: string,
): string {
  return accepted.length === 0
    ? `Unknown parameter '${key}': ${command} takes no parameters.`
    : `Unknown parameter '${key}' for ${command}. Accepted parameters: ${accepted.join(", ")}.`;
}

const SHELL_SPLIT_INITIALS = new Set([
  "=",
  "!",
  "<",
  ">",
  "&",
  "|",
  "+",
  "-",
  "*",
  "/",
  "%",
  '"',
  "'",
  "`",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
]);

const VAULT_AFTER_COMMAND_MESSAGE =
  "vault must come before the command name (obsidian vault=<name> zotlit:...); placed after, Obsidian ignores it and routes the call by working directory or focused window instead.";
