// zotlit-design: the mechanical part of the Annotation View's design.
// annotation-view keeps the Annotation View to logical direction, the text
// scale and accessible tooltips. Rule tests: oxlint-plugin-design.test.ts.
import { regex } from "arkregex";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { RuleTester } from "oxlint/plugins-dev";
import postcss from "postcss";

type Rule = Parameters<RuleTester["run"]>[1];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type Attribute = Parameters<NonNullable<Visitor["JSXAttribute"]>>[0];
type Node = NonNullable<Attribute["parent"]>;

/** Class fragments in JSX expressions: literals, templates, clsx and branches. */
function classFragments(node: Node | null | undefined): string[] {
  if (!node) return [];
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? [node.value] : [];
    case "JSXExpressionContainer":
      return classFragments(node.expression);
    case "TemplateLiteral":
      return [
        ...node.quasis.map((part) => part.value.cooked ?? part.value.raw),
        ...node.expressions.flatMap(classFragments),
      ];
    case "CallExpression":
      return node.arguments.flatMap(classFragments);
    case "ConditionalExpression":
      return [
        ...classFragments(node.consequent),
        ...classFragments(node.alternate),
      ];
    case "BinaryExpression":
    case "LogicalExpression":
      return [...classFragments(node.left), ...classFragments(node.right)];
    case "ArrayExpression":
      return node.elements.flatMap(classFragments);
    case "ObjectExpression":
      return node.properties.flatMap((property) =>
        property.type === "Property" ? classFragments(property.key) : [],
      );
    default:
      return [];
  }
}

const whitespace = regex("\\s+");
const physicalUtility = regex.as<string, { captures: [] }>(
  "^(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|scroll-ml|scroll-mr)-",
);
const physicalProperty = regex(
  "^(?:margin|padding|border)-(?:left|right)(?:-|$)|^(?:left|right)$",
);
const pxSize = regex("^([0-9.]+)px$");

/** The last variant separator outside brackets, including zt: and hover:. */
function utility(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === "[") depth++;
    else if (token[i] === "]") depth--;
    else if (token[i] === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replaceAll("!", "").replace(regex("^-"), "");
}

function classProblems(tokens: string[]): string[] {
  const utilities = tokens.map(utility);
  const problems = new Set<string>();
  for (const value of utilities) {
    if (
      physicalUtility.test(value) ||
      value === "text-left" ||
      value === "text-right"
    )
      problems.add("Use logical direction utilities.");
    if (value.startsWith("text-[") || value === "uppercase")
      problems.add("Use the text scale and sentence case for chrome.");
    if (value.startsWith("columns-"))
      problems.add("Use grid for the Annotation list.");
    if (value === "transition-all")
      problems.add("Name the transitioned properties.");
  }
  if (
    utilities.some((value) => value.startsWith("line-clamp-")) &&
    utilities.some(
      (value) => value === "leading-tight" || value === "leading-none",
    )
  )
    problems.add("Pair line clamps with normal leading.");
  return [...problems];
}

/** Parse declarations so selectors, comments and strings cannot act as CSS rules. */
export function annotationCssProblems(
  source: string,
): { line: number; reason: string }[] {
  const problems: { line: number; reason: string }[] = [];
  postcss.parse(source).walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    const value = declaration.value.toLowerCase().trim();
    const add = (reason: string) =>
      problems.push({ line: declaration.source?.start?.line ?? 1, reason });
    if (
      physicalProperty.test(property) ||
      (property === "text-align" && (value === "left" || value === "right"))
    )
      add("Use logical CSS direction properties");
    const size = pxSize.exec(value);
    if (
      (property === "font-size" && size && Number(size[1]) < 11) ||
      (property === "text-transform" && value === "uppercase")
    )
      add("Use the text scale and sentence case for chrome");
    if (property === "columns" || property === "column-count")
      add("Use grid for the Annotation list");
    if (
      (property === "transition" || property === "transition-property") &&
      value
        .split(",")
        .some((part) => part.trim().split(whitespace).includes("all"))
    )
      add("Name the transitioned properties");
  });
  return problems;
}

/**
 * The Annotation View's design, in its JSX classes and in the CSS files it
 * imports (parsed, so selectors and comments cannot pass as rules). It
 * rejects:
 * - physical direction, which breaks right-to-left layouts;
 * - text below the scale and uppercase chrome;
 * - CSS columns for the card list, where grid keeps reading order;
 * - `transition: all`, which animates layout it never meant to;
 * - a line clamp with tight leading, which clips descenders;
 * - a `title` attribute, which screen readers and touch skip (use aria-label
 *   tooltips).
 */
export const annotationDesign: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep the Annotation View's layout, type and tooltips accessible.",
    },
    schema: [],
    messages: { design: "{{reason}} (Annotation View design)." },
  },
  create(context) {
    const report = (node: Node, reason: string) =>
      context.report({ node, messageId: "design", data: { reason } });
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (node.name.name === "title") report(node, "Use aria-label tooltips");
        if (node.name.name === "className") {
          const tokens = classFragments(node.value).flatMap((part) =>
            part.split(whitespace),
          );
          for (const reason of classProblems(tokens)) report(node, reason);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "setAttribute" &&
          node.arguments[0]?.type === "Literal" &&
          node.arguments[0].value === "title"
        )
          report(node, "Use aria-label tooltips");
      },
      ImportDeclaration(node) {
        if (!node.source.value.endsWith(".css")) return;
        // A stylesheet that moved into a package is imported by its package
        // path, so the import resolves as Node resolves it from the file.
        const file = node.source.value.startsWith(".")
          ? resolve(dirname(context.filename), node.source.value)
          : createRequire(context.filename).resolve(node.source.value);
        for (const problem of annotationCssProblems(readFileSync(file, "utf8")))
          report(
            node,
            `${node.source.value}:${problem.line}: ${problem.reason}`,
          );
      },
    };
  },
};

export default {
  meta: { name: "zotlit-design" },
  rules: {
    "annotation-view": annotationDesign,
  },
};
