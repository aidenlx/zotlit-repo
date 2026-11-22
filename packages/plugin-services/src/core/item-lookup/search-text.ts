import { regex } from "arkregex";

export interface SearchTerms {
  readonly words: string;
  readonly tags: readonly string[];
}

export interface SearchTokens<Name extends string> {
  readonly words: string;
  readonly tokens: { readonly [K in Name]: readonly string[] };
}

export function searchTokens<const Name extends string>(
  text: string,
  names: readonly Name[],
): SearchTokens<Name> {
  const tokens = Object.fromEntries(
    names.map((name) => [name, [] as string[]]),
  ) as Record<Name, string[]>;
  const isName = (name: string): name is Name =>
    (names as readonly string[]).includes(name);
  let rest = "";
  let from = 0;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
    const name = match.groups.name.toLowerCase();
    if (!isName(name)) continue;
    tokens[name].push(match.groups.quoted ?? match.groups.bare);
    rest += `${text.slice(from, match.index)} `;
    from = match.index + match[0].length;
  }
  rest += text.slice(from);
  const words = rest.split(/\s+/).filter(Boolean);
  return { words: words.join(" "), tokens };
}

const TOKEN = regex(
  '(?:^|\\s)(?<name>[a-z]+):(?:"(?<quoted>[^"]+)"|(?<bare>[^\\s"]+))',
  "gi",
);

export function searchTerms(text: string): SearchTerms {
  const { words, tokens } = searchTokens(text, ["tag"]);
  return { words, tags: tokens.tag };
}
