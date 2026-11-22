import type { TemplateLanguage } from "./constants.ts";

type CitationVariant = "main" | "alt";

export const DEFAULT_CITATION_BRANCHES = {
  liquid: {
    main: "{{ zt.citations | pandoc_cite }}",
    alt: '{{ zt.citations | pandoc_cite: "prefer-author-in-text" }}',
  },
  eta: {
    main: "<%= pandocCite(zt.citations) %>",
    alt: '<%= pandocCite(zt.citations, "prefer-author-in-text") %>',
  },
} as const satisfies Record<TemplateLanguage, Record<CitationVariant, string>>;

const BRANCH_TAGS = {
  liquid: {
    open: '{% if zt.variant == "alt" %}',
    otherwise: "{% else %}",
    close: "{% endif %}",
  },
  eta: {
    open: '<% if (zt.variant === "alt") { %>',
    otherwise: "<% } else { %>",
    close: "<% } %>",
  },
} as const satisfies Record<TemplateLanguage, object>;

export interface LegacyCitationSources {
  readonly language: TemplateLanguage;
  readonly main?: string;
  readonly alt?: string;
}

export function foldLegacyCitationTemplates({
  language,
  main,
  alt,
}: LegacyCitationSources): string {
  const branches = DEFAULT_CITATION_BRANCHES[language];
  const tags = BRANCH_TAGS[language];
  return [
    tags.open,
    indentBranch(alt ?? branches.alt),
    tags.otherwise,
    indentBranch(main ?? branches.main),
    tags.close,
    "",
  ].join("\n");
}

function indentBranch(source: string): string {
  return source.trimEnd().replaceAll(/^(?!$)/gm, "  ");
}
