import type {
  ContractAdditionalMembers,
  ContractExample,
  ContractLiteral,
  ContractMember,
  ContractNamedType,
  ContractObject,
  ContractRef,
  ContractStringified,
  ContractType,
} from "#contract/ir.ts";
import { regex } from "arkregex";
import { Node } from "ts-morph";
import type {
  InterfaceDeclaration,
  JSDoc,
  JSDocTag,
  Signature,
  Symbol as TypeSymbol,
  Type,
} from "ts-morph";

const TEMPORAL_LIB = "lib.esnext.temporal.d.ts";

const DROPPED_MEMBER = "toString";

const FILTER_TAG = "ztFilter";

const INERT_TAG = "ztInert";

export const TEMPLATE_ITEM_BASE_DATA = "TemplateItemBaseData";

const FILTER_NAME = /^[a-z][a-z0-9_]*$/;

const FENCE = "```";

const EXAMPLE_FENCE = regex(
  `^${FENCE}(?<lang>[a-z0-9-]*)\n(?<code>.*?)\n?${FENCE}$`,
  "s",
);

const WALKING: ContractNamedType = { kind: "object", members: [] };

interface NamedType {
  name: string;
  declaration: Node;
}

export class ContractExtractor {
  readonly #srcDir: string;
  readonly #types = new Map<string, ContractNamedType>();
  readonly #registered = new Map<string, string>();

  constructor(srcDir: string) {
    this.#srcDir = srcDir;
  }

  get types(): Record<string, ContractNamedType> {
    return Object.fromEntries(this.#types);
  }

  addRoot(declaration: InterfaceDeclaration): string {
    return this.#register(declaration.getType(), {
      name: declaration.getName(),
      declaration,
    }).name;
  }

  #register(type: Type, named: NamedType): ContractRef {
    const identity = type.getText();
    const registered = this.#registered.get(named.name);
    if (registered === undefined) {
      this.#registered.set(named.name, identity);
      this.#types.set(named.name, WALKING);
      this.#types.set(named.name, this.#define(type, named.declaration));
    } else if (registered !== identity) {
      throw new Error(
        `Two contract types claim the name ${named.name}: ${registered} and ${identity}`,
      );
    }
    return { kind: "ref", name: named.name };
  }

  #define(type: Type, declaration: Node): ContractNamedType {
    const description = jsDocOf(declaration);
    if (type.isUnion()) {
      return {
        kind: "union",
        description,
        options:
          declaredLiteralOptions(declaration) ??
          this.#options(type, declaration),
      };
    }
    const { members, additional } = this.#object(type, declaration);
    return { kind: "object", description, members, additional };
  }

  #object(type: Type, location: Node): ContractObject {
    return {
      kind: "object",
      members: type
        .getProperties()
        .filter((property) => property.getName() !== DROPPED_MEMBER)
        .map((property) => this.#member(property, location)),
      additional: this.#additional(type, location),
    };
  }

  #member(property: TypeSymbol, location: Node): ContractMember {
    const name = property.getName();
    const declaration = property.getValueDeclaration();
    const type = property.getTypeAtLocation(location);
    return {
      name,
      description: jsDocOf(declaration),
      optional: property.isOptional() || carriesUndefined(type),
      type: this.#memberType({
        name,
        type,
        location,
        filter: filterOf(declaration, name),
        inert: inertOf(declaration, name),
      }),
      examples: examplesOf(declaration, name),
    };
  }

  #memberType({
    name,
    type,
    location,
    filter,
    inert,
  }: {
    name: string;
    type: Type;
    location: Node;
    filter: string | undefined;
    inert: true | undefined;
  }): ContractType {
    const options = type.isUnion() ? type.getUnionTypes() : [type];
    const callable = options.filter(
      (option) => option.getCallSignatures().length > 0,
    );
    if (callable.length === 0) {
      if (filter) {
        throw new Error(
          `@${FILTER_TAG} on a member that is no contract helper: ${name}`,
        );
      }
      if (inert) {
        throw new Error(
          `@${INERT_TAG} on a member that is no contract helper: ${name}`,
        );
      }
      return this.#walk(type, location);
    }
    if (callable.length > 1) {
      throw new Error(
        `A contract helper has multiple callable options in its union: ${type.getText()}`,
      );
    }
    const signatures = callable[0]!.getCallSignatures();
    if (signatures.length > 1) {
      throw new Error(
        `A contract helper has multiple overload signatures: ${type.getText()}`,
      );
    }
    const [signature] = signatures;
    const helper: ContractType = {
      kind: "helper",
      name,
      signature: renderSignature(signature!),
      filter,
      inert,
      value: this.#walk(signature!.getReturnType(), location),
    };
    const values = options
      .filter(
        (option) =>
          !option.isUndefined() && option.getCallSignatures().length === 0,
      )
      .map((option) => this.#walk(option, location));
    if (values.length === 0) return helper;
    return { kind: "union", options: [helper, ...sortNullsLast(values)] };
  }

  #walk(type: Type, location: Node): ContractType {
    if (type.isStringLiteral()) {
      return { kind: "literal", value: type.getLiteralValue() as string };
    }
    if (type.isNumberLiteral()) {
      return { kind: "literal", value: type.getLiteralValue() as number };
    }
    if (type.isBooleanLiteral()) {
      return { kind: "literal", value: type.getText() === "true" };
    }
    if (type.isString()) return { kind: "primitive", type: "string" };
    if (type.isNumber()) return { kind: "primitive", type: "number" };
    if (type.isBoolean()) return { kind: "primitive", type: "boolean" };
    if (type.isNull()) return { kind: "primitive", type: "null" };
    if (type.isAny() || type.isUnknown()) return { kind: "unknown" };
    if (type.isArray()) {
      const items = this.#walk(type.getArrayElementTypeOrThrow(), location);
      return { kind: "array", items };
    }

    const stringified = temporalOf(type);
    if (stringified) return stringified;

    if (type.getCallSignatures().length > 0) {
      throw new Error(
        `A function is only a contract helper as a direct member: ${type.getText()}`,
      );
    }

    const named = this.#nameOf(type);
    if (named) return this.#register(type, named);

    if (type.isUnion()) {
      const options = this.#options(type, location);
      return options.length === 1 ? options[0]! : { kind: "union", options };
    }
    if (type.isObject() || type.isIntersection()) {
      const values = type.getStringIndexType();
      if (values && type.getProperties().length === 0) {
        return { kind: "record", values: this.#walk(values, location) };
      }
      return this.#object(type, location);
    }
    throw new Error(`Unsupported contract type: ${type.getText()}`);
  }

  #options(type: Type, location: Node): ContractType[] {
    const options = type
      .getUnionTypes()
      .filter((option) => !option.isUndefined())
      .map((option) => this.#walk(option, location));
    return sortNullsLast(options);
  }

  #additional(
    type: Type,
    location: Node,
  ): ContractAdditionalMembers | undefined {
    const values = type.getStringIndexType();
    if (!values) return undefined;
    return {
      description: indexSignatureDoc(type),
      type: this.#walk(values, location),
      schema: extendsInterface(type, TEMPLATE_ITEM_BASE_DATA)
        ? "item-fields"
        : "open",
    };
  }

  #nameOf(type: Type): NamedType | undefined {
    const symbol = type.getAliasSymbol() ?? type.getSymbol();
    const name = symbol?.getName();
    const declaration = symbol?.getDeclarations()[0];
    if (!name || name.startsWith("__") || !declaration) return undefined;
    return declaration.getSourceFile().getFilePath().startsWith(this.#srcDir)
      ? { name, declaration }
      : undefined;
  }
}

function declaredLiteralOptions(
  declaration: Node,
): ContractLiteral[] | undefined {
  if (!Node.isTypeAliasDeclaration(declaration)) return undefined;
  const union = declaration.getTypeNode();
  if (!Node.isUnionTypeNode(union)) return undefined;
  const text = declaration.getSourceFile().getFullText();
  const options: ContractLiteral[] = [];
  let cursor = union.getFullStart();
  for (const member of union.getTypeNodes()) {
    if (!Node.isLiteralTypeNode(member)) return undefined;
    const literal = member.getLiteral();
    if (!Node.isStringLiteral(literal) && !Node.isNumericLiteral(literal)) {
      return undefined;
    }
    const description = blockDocIn(text.slice(cursor, member.getStart()));
    cursor = member.getEnd();
    options.push({
      kind: "literal",
      value: literal.getLiteralValue(),
      description,
    });
  }
  return options;
}

const BLOCK_DOC = regex(`/\\*\\*(?<body>.*?)\\*/`, "gs");

function blockDocIn(slice: string): string | undefined {
  const bodies = [...slice.matchAll(BLOCK_DOC)];
  const body = bodies.at(-1)?.groups?.body;
  if (body === undefined) return undefined;
  return (
    body
      .split("\n")
      .map((line) => line.replace(/^\s*\*? ?/, ""))
      .join("\n")
      .trim() || undefined
  );
}

function isNullOption(option: ContractType): boolean {
  return option.kind === "primitive" && option.type === "null";
}

function sortNullsLast(options: ContractType[]): ContractType[] {
  const nulls = options.filter(isNullOption);
  return [...options.filter((option) => !isNullOption(option)), ...nulls];
}

function extendsInterface(type: Type, name: string): boolean {
  for (const declaration of type.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isInterfaceDeclaration(declaration)) continue;
    if (declaration.getName() === name) return true;
    for (const base of declaration.getBaseDeclarations()) {
      if (extendsInterface(base.getType(), name)) return true;
    }
  }
  return false;
}

function carriesUndefined(type: Type): boolean {
  return (
    type.isUndefined() || type.getUnionTypes().some((o) => o.isUndefined())
  );
}

function docOf(declaration: Node | undefined): JSDoc | undefined {
  if (!declaration || !Node.isJSDocable(declaration)) return undefined;
  return declaration.getJsDocs().at(-1);
}

function jsDocOf(declaration: Node | undefined): string | undefined {
  return docOf(declaration)?.getCommentText()?.trim() || undefined;
}

function tagsOf(declaration: Node | undefined, name: string): JSDocTag[] {
  const tags = docOf(declaration)?.getTags() ?? [];
  return tags.filter((tag) => tag.getTagName() === name);
}

function singleTagContent(
  declaration: Node | undefined,
  tagName: string,
  member: string,
): string | undefined {
  const tags = tagsOf(declaration, tagName);
  if (tags.length === 0) return undefined;
  if (tags.length > 1) {
    throw new Error(`Member ${member} declares more than one @${tagName}`);
  }
  return tags[0]!.getCommentText()?.trim() ?? "";
}

function filterOf(
  declaration: Node | undefined,
  member: string,
): string | undefined {
  const filter = singleTagContent(declaration, FILTER_TAG, member);
  if (filter === undefined) return undefined;
  if (!FILTER_NAME.test(filter)) {
    throw new Error(
      `@${FILTER_TAG} on ${member} names one snake_case filter and nothing else: ${filter}`,
    );
  }
  return filter;
}

function inertOf(
  declaration: Node | undefined,
  member: string,
): true | undefined {
  const content = singleTagContent(declaration, INERT_TAG, member);
  if (content === undefined) return undefined;
  if (content !== "") {
    throw new Error(
      `@${INERT_TAG} on ${member} must hold no content, found: ${content}`,
    );
  }
  return true;
}

function examplesOf(
  declaration: Node | undefined,
  member: string,
): ContractExample[] | undefined {
  const tags = tagsOf(declaration, "example");
  if (tags.length === 0) return undefined;
  return tags.map((tag) => {
    const text = tag.getCommentText()?.trim() ?? "";
    const groups = EXAMPLE_FENCE.exec(text)?.groups;
    if (!groups || groups.code.includes(FENCE)) {
      throw new Error(
        `@example on ${member} holds no single fenced code block: ${text}`,
      );
    }
    return { lang: groups.lang || undefined, code: groups.code };
  });
}

function indexSignatureDoc(type: Type): string | undefined {
  for (const declaration of type.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isInterfaceDeclaration(declaration)) continue;
    const found = interfaceIndexSignatureDoc(declaration);
    if (found) return found;
  }
  return undefined;
}

function interfaceIndexSignatureDoc(
  declaration: InterfaceDeclaration,
): string | undefined {
  const own = declaration.getIndexSignatures()[0];
  if (own) return jsDocOf(own);
  for (const base of declaration.getBaseDeclarations()) {
    if (!Node.isInterfaceDeclaration(base)) continue;
    const found = interfaceIndexSignatureDoc(base);
    if (found) return found;
  }
  return undefined;
}

function temporalOf(type: Type): ContractStringified | undefined {
  const symbol = type.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (
    !symbol ||
    !declaration?.getSourceFile().getFilePath().endsWith(TEMPORAL_LIB)
  ) {
    return undefined;
  }
  return { kind: "stringified", type: `Temporal.${symbol.getName()}` };
}

function renderSignature(signature: Signature): string {
  const declaration = signature.getDeclaration();
  if (!Node.isSignaturedDeclaration(declaration)) {
    throw new Error(`Unsupported helper signature: ${declaration.getText()}`);
  }
  const parameters = declaration.getParameters().map((parameter) => {
    const optional = parameter.hasQuestionToken() ? "?" : "";
    const type =
      parameter.getTypeNode()?.getText() ?? parameter.getType().getText();
    return `${parameter.getName()}${optional}: ${type}`;
  });
  const returns =
    declaration.getReturnTypeNode()?.getText() ??
    signature.getReturnType().getText();
  return `(${parameters.join(", ")}) => ${returns}`;
}
