import { describe, expect, it } from "vitest";

import type { ContractExample } from "@zotlit/db/contract/ir";

import { renderContractTableMarkdown } from "./gfm.ts";
import { sectionOf } from "./model.ts";
import { buildPageModel } from "./page-model.ts";
import { IR, SPECS } from "./test-fixtures.ts";

const model = buildPageModel(IR, SPECS);

function modelWithLinkExample(example: ContractExample, sample = "leaf") {
  const ir = structuredClone(IR);
  const leaf = ir.types.Leaf;
  if (leaf?.kind !== "object")
    throw new Error("Fixture requires a Leaf object");
  leaf.members.find((member) => member.name === "link")!.examples = [example];
  const specs = SPECS.map((spec) =>
    spec.id === "leaf" ? { ...spec, sample } : spec,
  );
  return buildPageModel(ir, specs);
}

const linkExamples = [
  {
    name: "double-quoted filter arguments",
    code: '{{ zt.link | append: "zt.link" }}',
    expected: '{{ leaf.link | append: "zt.link" }}',
  },
  {
    name: "single-quoted tag arguments",
    code: "{% if zt.link == 'zt.link' %}x{% endif %}",
    expected: "{% if leaf.link == 'zt.link' %}x{% endif %}",
  },
  {
    name: "plain template text",
    code: "zt.link {{ zt.link }}",
    expected: "zt.link {{ leaf.link }}",
  },
  {
    name: "similarly named fields",
    code: "{{ zt.links }} {{ zt.link }} {{ zt.linkTitle }}",
    expected: "{{ zt.links }} {{ leaf.link }} {{ zt.linkTitle }}",
  },
  {
    name: "nested member access",
    code: "{{ zt.link.size }}",
    expected: "{{ leaf.link.size }}",
  },
  {
    name: "for tag arguments",
    code: "{% for x in zt.link %}{{ x }}{% endfor %}",
    expected: "{% for x in leaf.link %}{{ x }}{% endfor %}",
  },
  {
    name: "a dotted item sample",
    sample: "zt.parentItem",
    code: "{{ zt.link }}",
    expected: "{{ zt.parentItem.link }}",
  },
  {
    name: "a dotted citation sample",
    sample: "citation.item",
    code: "{{ zt.link }}",
    expected: "{{ citation.item.link }}",
  },
  {
    name: "raw blocks",
    code: "{% raw %}{{ zt.link }}{% endraw %}",
    expected: "{% raw %}{{ zt.link }}{% endraw %}",
  },
  {
    name: "elsif and unless operators",
    code: "{% if false %}{% elsif zt.link != 'zt.link' and zt.link contains 'zt.link' %}{% unless 'zt.link' == zt.link %}x{% endunless %}{% endif %}",
    expected:
      "{% if false %}{% elsif leaf.link != 'zt.link' and leaf.link contains 'zt.link' %}{% unless 'zt.link' == leaf.link %}x{% endunless %}{% endif %}",
  },
  {
    name: "assign filter arguments",
    code: "{% assign x = zt.link | append: 'zt.link' %}",
    expected: "{% assign x = leaf.link | append: 'zt.link' %}",
  },
  {
    name: "case and when arguments",
    code: "{% case zt.link %}{% when 'zt.link', zt.link %}x{% endcase %}",
    expected:
      "{% case leaf.link %}{% when 'zt.link', leaf.link %}x{% endcase %}",
  },
  {
    name: "multi-line liquid tag arguments",
    code: "{% liquid\n  assign x = zt.link | append: 'zt.link'\n  echo zt.link\n%}",
    expected:
      "{% liquid\n  assign x = leaf.link | append: 'zt.link'\n  echo leaf.link\n%}",
  },
  {
    name: "named filter arguments",
    code: "{{ zt.links | example: key: zt.link, fallback: 'zt.link', zt.link }}",
    expected:
      "{{ zt.links | example: key: leaf.link, fallback: 'zt.link', leaf.link }}",
  },
  {
    name: "unlabelled examples with authored whitespace",
    code: "Start\n{{-  zt.link  -}}\nEnd",
    expected: "Start\n{{-  leaf.link  -}}\nEnd",
    unlabelled: true,
  },
];

describe("Liquid contract examples", () => {
  it.each(linkExamples)(
    "retargets model examples with $name",
    ({ code, expected, sample, unlabelled }) => {
      const example = unlabelled ? { code } : { lang: "liquid", code };
      const page = modelWithLinkExample(example, sample);
      const row = sectionOf(page, "leaf").tables[0]!.rows.find(
        (entry) => entry.name === "link",
      );

      expect(row?.examples).toEqual([{ ...example, code: expected }]);
    },
  );

  it.each(linkExamples)(
    "presents the retargeted reference row for $name",
    ({ code, expected, sample, unlabelled }) => {
      const example = unlabelled ? { code } : { lang: "liquid", code };
      const page = modelWithLinkExample(example, sample);
      const table = renderContractTableMarkdown(page, "leaf");
      const row = table.split("\n").find((line) => line.startsWith("| `link`"));

      expect(row).toContain(
        `Example: \`${expected.replaceAll("|", "\\|").replaceAll(/\s+/g, " ")}\`.`,
      );
    },
  );
});

describe("renderContractTableMarkdown", () => {
  it("renders the prefixed root table with header, delimiter, and prefixed rows", () => {
    const table = renderContractTableMarkdown(model, "root");

    expect(table).toContain("| Property | Type | Description |");
    expect(table).toContain("| --- | --- | --- |");
    expect(table).toContain("| `zt.name` | `string` |");
    expect(table).toContain("| `zt.label?` | `string \\| null` |");
  });

  it("links a row's type to the section documenting it", () => {
    const table = renderContractTableMarkdown(model, "root");

    expect(table).toContain("| `zt.leaves` | [`Leaf[]`](#leaf) |");
  });

  it("escapes pipes in a full type so the row keeps three cells", () => {
    const table = renderContractTableMarkdown(model, "leaf");
    const row = table.split("\n").find((line) => line.startsWith("| `kind`"))!;

    expect(row).toContain('"a" \\| "b" \\| "c" \\| "d"');
    expect(row.split(/(?<!\\)\|/).slice(1, -1)).toHaveLength(3);
  });

  it("presents helper signature, engine usage, filter, and example notes in a row", () => {
    const table = renderContractTableMarkdown(model, "leaf");
    const row = table.split("\n").find((line) => line.startsWith("| `link`"))!;

    expect(row).toContain(
      "Signature: `(alias?: string, subpath?: string) => string`.",
    );
    expect(row).toContain("Liquid: `{{ leaf.link }}`.");
    expect(row).toContain("Eta: `<%= leaf.link(alias, subpath) %>`.");
    expect(row).toContain(
      "Liquid filter: `{{ leaf \\| leaf_link: alias, subpath }}`.",
    );
    expect(row).toContain("Example: `{{ leaf.link }}`.");
  });

  it("links a root-scoped reference row back to the root section", () => {
    const table = renderContractTableMarkdown(model, "leaf");

    expect(table).toContain("| `owner` | [`zt`](#root) |");
  });

  it("emits one table per type with its caption, in order", () => {
    const table = renderContractTableMarkdown(model, "pair");
    const first = table.indexOf("**First**");
    const second = table.indexOf("**Second**");

    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(table).toContain("| `year` | `number` | Year. |");
  });

  it("renders the item-type map as an Item type / Fields table", () => {
    const table = renderContractTableMarkdown(model, "item-types");

    expect(table).toContain("| Item type | Fields |");
    expect(table).toContain("| --- | --- |");
    expect(table).toContain("| `book` | `title`, `publisher` |");
  });

  it("throws on an unknown section id", () => {
    expect(() => renderContractTableMarkdown(model, "missing")).toThrow(
      /No contract section missing/,
    );
  });
});
