import { regex } from "arkregex";
import type { Token } from "liquidjs";
import { Tokenizer, TypeGuards } from "liquidjs";

import type {
  ContractExample,
  ContractHelper,
  ContractIR,
  ContractMember,
  ContractNamedType,
  ContractObject,
  ContractType,
} from "@zotlit/db/contract/ir";

import type {
  Doc,
  HelperPresentation,
  InlineNode,
  ItemTypeRow,
  PageModel,
  PageSection,
  RowModel,
  SectionValue,
  TableModel,
} from "./model.ts";
import type { SectionSpec } from "./sections.ts";
import { SECTIONS } from "./sections.ts";

import { inlineCodeSpans } from "#mdx-text";

interface ReferenceTarget {
  path: string;
  href: string;
}

export function buildPageModel(
  ir: ContractIR,
  specs: readonly SectionSpec[] = SECTIONS,
): PageModel {
  const warnings: string[] = [];
  const context: BuildContext = {
    ir,
    specs,
    references: collectReferences(ir, specs),
    warnings,
  };
  assertEveryTypeIsPlaced(ir, specs);
  return {
    sections: specs.map((spec) => buildSection(spec, context)),
    warnings,
  };
}

interface BuildContext {
  ir: ContractIR;
  specs: readonly SectionSpec[];
  references: ReadonlyMap<string, ReferenceTarget>;
  warnings: string[];
}

function sectionForType(
  specs: readonly SectionSpec[],
  type: string,
): SectionSpec | undefined {
  return specs.find((section) => section.types?.includes(type));
}

function collectReferences(
  ir: ContractIR,
  specs: readonly SectionSpec[],
): Map<string, ReferenceTarget> {
  const references = new Map<string, ReferenceTarget>();
  for (const [root, rootIR] of Object.entries(ir.roots)) {
    const section = sectionForType(specs, rootIR.type);
    if (!section) {
      throw new Error(`No section documents ${rootIR.type} (the ${root} root)`);
    }
    for (const { owner, member, path } of rootIR.references) {
      references.set(`${owner}.${member}`, { path, href: `#${section.id}` });
    }
  }
  return references;
}

function assertEveryTypeIsPlaced(
  ir: ContractIR,
  specs: readonly SectionSpec[],
): void {
  const placed = new Set(specs.flatMap((section) => section.types ?? []));
  const missing = Object.keys(ir.types).filter((name) => !placed.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Contract types with no section in lib/template-contract/sections.ts: ${missing.join(", ")}`,
    );
  }
}

function buildSection(spec: SectionSpec, context: BuildContext): PageSection {
  const types = (spec.types ?? []).map(
    (name) => [name, namedType(context.ir, name)] as const,
  );
  const [firstName, firstType] = types[0] ?? [];
  const tables = sectionTables(spec, context.ir).map((slot) =>
    buildTable({ ...slot, describeHere: types.length > 1 }, spec, context),
  );
  if (spec.captions && spec.captions.length !== tables.length) {
    throw new Error(
      `Section ${spec.id} declares ${spec.captions.length} captions for ${tables.length} tables`,
    );
  }
  if (!spec.captions && tables.length > 1) {
    throw new Error(
      `Section ${spec.id} holds ${tables.length} tables and no captions`,
    );
  }
  for (const [name, type] of types) {
    if (!type.description)
      context.warnings.push(`${name} has no type description`);
  }
  return {
    id: spec.id,
    title: spec.title,
    level: spec.level,
    lead: spec.lead,
    include: spec.include,
    description:
      types.length > 1
        ? []
        : normalizeDoc(firstType?.description, firstName, context),
    tables,
    values: types.flatMap(([name, type]) =>
      literalOptionsOf(name, type, context),
    ),
    itemTypes: spec.itemTypes ? itemTypeRows(context.ir) : [],
  };
}

function namedType(ir: ContractIR, name: string): ContractNamedType {
  const type = ir.types[name];
  if (!type) throw new Error(`Contract IR carries no ${name} type`);
  return type;
}

function sectionTables(spec: SectionSpec, ir: ContractIR): TableSlot[] {
  const objects = (spec.types ?? []).flatMap((name) =>
    variantsOf(name, namedType(ir, name)),
  );
  return objects.map(([owner, object], index) => ({
    owner,
    object,
    id: objects.length > 1 ? `${spec.id}-${index + 1}` : spec.id,
    index,
  }));
}

function variantsOf(
  name: string,
  type: ContractNamedType,
): Array<readonly [string, ContractObject]> {
  if (type.kind === "object") return [[name, type] as const];
  return type.options
    .filter((option) => option.kind === "object")
    .map((option) => [name, option] as const);
}

function literalOptionsOf(
  name: string,
  type: ContractNamedType,
  context: BuildContext,
): SectionValue[] {
  if (type.kind !== "union") return [];
  return type.options.flatMap((option) => {
    if (option.kind !== "literal") return [];
    if (!option.description) {
      context.warnings.push(
        `${name} option ${option.value} has no description`,
      );
    }
    return [
      {
        value: String(option.value),
        description: normalizeDoc(option.description, name, context),
      },
    ];
  });
}

function itemTypeRows(ir: ContractIR): ItemTypeRow[] {
  return Object.entries(ir.itemTypes).map(([itemType, fields]) => ({
    itemType,
    fields,
  }));
}

interface TableSlot {
  owner: string;
  object: ContractObject;
  id: string;
  index: number;
}

function buildTable(
  {
    owner,
    object,
    id,
    index,
    describeHere,
  }: TableSlot & { describeHere: boolean },
  spec: SectionSpec,
  context: BuildContext,
): TableModel {
  return {
    id,
    caption: spec.captions?.[index],
    description: describeHere
      ? normalizeDoc(context.ir.types[owner]?.description, owner, context)
      : [],
    prefix: spec.prefix,
    rows: object.members.map((member) =>
      buildRow(member, { owner, spec }, context),
    ),
  };
}

function buildRow(
  member: ContractMember,
  { owner, spec }: { owner: string; spec: SectionSpec },
  context: BuildContext,
): RowModel {
  if (!member.description) {
    context.warnings.push(`${owner}.${member.name} has no description`);
  }
  const reference = context.references.get(`${owner}.${member.name}`);
  const helper = findHelper(member.type);
  const type = reference
    ? {
        shortType: reference.path,
        fullType: reference.path,
        typeHref: reference.href,
      }
    : {
        shortType: renderType(member.type, true),
        fullType: renderType(member.type, false),
        typeHref: typeHrefFor(member.type, context.specs),
      };
  return {
    name: member.name,
    optional: member.optional,
    ...type,
    description: normalizeDoc(member.description, owner, context),
    examples: retarget(member.examples ?? [], member.name, spec),
    helper:
      helper && !reference
        ? presentHelper(helper, member.name, spec)
        : undefined,
  };
}

function retarget(
  examples: readonly ContractExample[],
  name: string,
  spec: SectionSpec,
): readonly ContractExample[] {
  const sample = spec.sample ?? "zt";
  if (sample === "zt") return examples;
  return examples.map((example) => ({
    ...example,
    code: retargetLiquidExample(example.code, name, sample),
  }));
}

function retargetLiquidExample(code: string, member: string, sample: string) {
  const edits: Token[] = [];

  function collectAccesses(token: Token | undefined) {
    if (TypeGuards.isPropertyAccessToken(token)) {
      const [root, field] = token.props;
      if (
        token.variable === undefined &&
        TypeGuards.isWordToken(root) &&
        root.getText() === "zt" &&
        TypeGuards.isWordToken(field) &&
        field.getText() === member
      ) {
        edits.push(root);
      }
      collectAccesses(token.variable);
      token.props.forEach(collectAccesses);
    } else if (TypeGuards.isFilteredValueToken(token)) {
      token.initial.postfix.forEach(collectAccesses);
      for (const filter of token.filters) {
        for (const arg of filter.args) {
          collectAccesses(Array.isArray(arg) ? arg[1] : arg);
        }
      }
    } else if (TypeGuards.isRangeToken(token)) {
      collectAccesses(token.lhs);
      collectAccesses(token.rhs);
    }
  }

  for (const token of new Tokenizer(code).readTopLevelTokens()) {
    if (TypeGuards.isTagToken(token)) {
      const tags =
        token.name === "liquid"
          ? token.tokenizer.readLiquidTagTokens()
          : [token];
      for (const { tokenizer } of tags) {
        while (!tokenizer.end()) {
          if (tokenizer.readOperator()) continue;
          const value = tokenizer.readValue();
          if (value) {
            tokenizer.skipBlank();
            if (tokenizer.peek() !== ":") collectAccesses(value);
          } else {
            tokenizer.advance();
          }
        }
      }
    } else if (TypeGuards.isOutputToken(token)) {
      const output = new Tokenizer(
        code,
        undefined,
        undefined,
        token.contentRange,
      );
      collectAccesses(output.readFilteredValue());
    }
  }

  let retargeted = code;
  for (const { begin, end } of edits.toSorted((a, b) => b.begin - a.begin)) {
    retargeted = retargeted.slice(0, begin) + sample + retargeted.slice(end);
  }
  return retargeted;
}

function findHelper(type: ContractType): ContractHelper | undefined {
  switch (type.kind) {
    case "helper":
      return type;
    case "array":
      return findHelper(type.items);
    case "union":
      return type.options.map(findHelper).find((found) => found !== undefined);
    default:
      return undefined;
  }
}

function presentHelper(
  { signature, filter }: ContractHelper,
  name: string,
  spec: SectionSpec,
): HelperPresentation {
  const sample = spec.sample ?? "zt";
  const parameters = parameterNames(signature);
  const args = parameters.join(", ");
  return {
    signature,
    liquid: `{{ ${sample}.${name} }}`,
    eta: `<%= ${sample}.${name}(${args}) %>`,
    filter: filter && `{{ ${sample} | ${filter}${args ? `: ${args}` : ""} }}`,
  };
}

function parameterNames(signature: string): string[] {
  const parameters = signature.slice(1, signature.indexOf(")"));
  return parameters
    .split(",")
    .map((parameter) => parameter.split(":")[0]!.replace("?", "").trim())
    .filter((parameter) => parameter.length > 0);
}

function typeHrefFor(
  type: ContractType,
  specs: readonly SectionSpec[],
): string | undefined {
  const named = unwrapRef(type);
  const section = named ? sectionForType(specs, named) : undefined;
  return section && `#${section.id}`;
}

function unwrapRef(type: ContractType): string | undefined {
  switch (type.kind) {
    case "ref":
      return type.name;
    case "array":
      return unwrapRef(type.items);
    case "helper":
      return unwrapRef(type.value);
    case "union": {
      const named = type.options
        .filter(
          (option) => option.kind !== "primitive" || option.type !== "null",
        )
        .map(unwrapRef);
      return named.length === 1 ? named[0] : undefined;
    }
    default:
      return undefined;
  }
}

const SHORT_UNION_OPTIONS = 3;

function renderType(type: ContractType, short: boolean): string {
  switch (type.kind) {
    case "primitive":
      return type.type;
    case "literal":
      return JSON.stringify(type.value);
    case "unknown":
      return "unknown";
    case "array": {
      const items = renderType(type.items, short);
      return items.includes(" | ") ? `(${items})[]` : `${items}[]`;
    }
    case "record":
      return `Record<string, ${renderType(type.values, short)}>`;
    case "ref":
      return type.name;
    case "stringified":
      return type.type;
    case "helper":
      return short ? renderType(type.value, short) : type.signature;
    case "object":
      return short
        ? "object"
        : `{ ${type.members
            .map(
              (member) =>
                `${member.name}${member.optional ? "?" : ""}: ${renderType(member.type, short)}`,
            )
            .join("; ")} }`;
    case "union": {
      const options = type.options.map((option) => {
        const rendered = renderType(option, short);
        return rendered.includes("=>") ? `(${rendered})` : rendered;
      });
      if (short && options.length > SHORT_UNION_OPTIONS) {
        return `${options.slice(0, SHORT_UNION_OPTIONS).join(" | ")} | …`;
      }
      return options.join(" | ");
    }
  }
}

const DOC_LINK = regex("\\{@link\\s+(?<target>[^}\\s]+)}", "g");

export function normalizeDoc(
  text: string | undefined,
  owner: string | undefined,
  context: Pick<BuildContext, "ir" | "specs">,
): Doc {
  if (!text) return [];
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) =>
      splitInline(paragraph.replaceAll(/\s+/g, " ").trim(), owner, context),
    );
}

function splitInline(
  paragraph: string,
  owner: string | undefined,
  context: Pick<BuildContext, "ir" | "specs">,
): InlineNode[] {
  const nodes: InlineNode[] = [];
  function appendProse(text: string) {
    let cursor = 0;
    for (let match = DOC_LINK.exec(text); match; match = DOC_LINK.exec(text)) {
      if (match.index > cursor) {
        nodes.push({ kind: "text", value: text.slice(cursor, match.index) });
      }
      nodes.push(resolveLink(match.groups.target, owner, context));
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) {
      nodes.push({ kind: "text", value: text.slice(cursor) });
    }
  }
  let cursor = 0;
  for (const { start, end, value } of inlineCodeSpans(paragraph)) {
    appendProse(paragraph.slice(cursor, start));
    nodes.push(code(value));
    cursor = end;
  }
  appendProse(paragraph.slice(cursor));
  return nodes;
}

function resolveLink(
  target: string,
  owner: string | undefined,
  context: Pick<BuildContext, "ir" | "specs">,
): InlineNode {
  const [head, member] = target.split(".");
  if (member) return memberLink(head!, member, context) ?? code(target);
  const section = sectionForType(context.specs, head!);
  if (section) {
    return { kind: "link", href: `#${section.id}`, text: head!, code: true };
  }
  const own = owner ? memberLink(owner, head!, context) : undefined;
  return own ?? code(head!);
}

function memberLink(
  owner: string,
  member: string,
  { ir, specs }: Pick<BuildContext, "ir" | "specs">,
): InlineNode | undefined {
  const section = sectionForType(specs, owner);
  if (!section || !ir.types[owner]) return undefined;
  const slot = sectionTables(section, ir).find(
    (entry) =>
      entry.owner === owner &&
      entry.object.members.some((candidate) => candidate.name === member),
  );
  if (!slot) return undefined;
  return {
    kind: "link",
    href: `#${slot.id}-${member}`,
    text: member,
    code: true,
  };
}

function code(value: string): InlineNode {
  return { kind: "code", value };
}
