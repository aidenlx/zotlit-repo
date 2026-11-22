type CaptureMap = Record<string, { name: string }>;

const endCaptures = {
  "1": { name: "keyword.control.whitespace.trim.eta" },
  "2": { name: "punctuation.section.embedded.end.eta" },
} satisfies CaptureMap;

const end = "([-_]?)(%>)";

const outputTag = (operator: string, scope: string) => ({
  name: `meta.tag.template.${scope}.eta`,
  begin: `(<%)([-_]?)\\s*(${RegExp.escape(operator)})`,
  beginCaptures: {
    "1": { name: "punctuation.section.embedded.begin.eta" },
    "2": { name: "keyword.control.whitespace.trim.eta" },
    "3": { name: "keyword.operator.output.eta" },
  } satisfies CaptureMap,
  end,
  endCaptures,
});

export const etaGrammar = {
  aliases: ["ejs"],
  embeddedLangs: [],
  fileTypes: ["eta", "eta.md", "ejs", "ejs.md"],
  name: "eta",
  patterns: [{ include: "#eta-tags" }],
  repository: {
    "eta-tags": {
      patterns: [
        {
          begin: "(<<%)([-_]?)\\s*(~)",
          beginCaptures: {
            "1": { name: "punctuation.section.embedded.begin.eta" },
            "2": { name: "keyword.control.whitespace.trim.eta" },
            "3": { name: "keyword.operator.output.raw.eta" },
          } as CaptureMap,
          end,
          endCaptures,
          name: "meta.tag.template.expression.raw.double.eta",
        },
        outputTag("~", "expression.raw"),
        outputTag("=", "expression.escaped"),
        {
          begin: "(<%)([-_]?)(?![=~])",
          beginCaptures: {
            "1": { name: "punctuation.section.embedded.begin.eta" },
            "2": { name: "keyword.control.whitespace.trim.eta" },
          } as CaptureMap,
          end,
          endCaptures,
          name: "meta.tag.template.script.eta",
        },
      ],
    },
  },
  scopeName: "text.html.eta",
};
