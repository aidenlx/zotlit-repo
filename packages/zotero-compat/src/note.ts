const NOTE_PREFIX = '<div class="zotero-note znv1">';
const NOTE_SUFFIX = "</div>";
const WRAPPED_RE = /^<div class="zotero-note znv[0-9]+">[\s\S]*<\/div>$/;
const MAX_TITLE_LENGTH = 120;

export function cleanNoteText(text: string): string {
  return Array.from(text)
    .filter((char) => {
      const code = char.codePointAt(0)!;
      return !(
        code <= 0x08 ||
        code === 0x0b ||
        code === 0x0c ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0x7f
      );
    })
    .join("")
    .trim();
}

export function wrapNote(text: string): string {
  return WRAPPED_RE.test(text) ? text : NOTE_PREFIX + text + NOTE_SUFFIX;
}

export function noteToTitle(html: string): string {
  let text = html.trim();
  text = text.replaceAll(/(<\/(h\d|p|div)+>)/g, "$1\n");
  text = text.replaceAll(/<br\s*\/?>/g, " ");
  text = unescapeHtml(text);
  if (/^<[^>\n]+[^/]>\n/.test(html)) text = text.trim();
  let title = text.slice(0, MAX_TITLE_LENGTH);
  const lineEnd = title.indexOf("\n");
  if (lineEnd > -1) title = title.slice(0, lineEnd);
  return title;
}

const LATIN_1_NAMES =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";

const OTHER_NAMES =
  "quot:22 amp:26 lt:3c gt:3e OElig:152 oelig:153 Scaron:160 scaron:161 Yuml:178 fnof:192 circ:2c6 tilde:2dc Alpha:391 Beta:392 Gamma:393 Delta:394 Epsilon:395 Zeta:396 Eta:397 Theta:398 Iota:399 Kappa:39a Lambda:39b Mu:39c Nu:39d Xi:39e Omicron:39f Pi:3a0 Rho:3a1 Sigma:3a3 Tau:3a4 Upsilon:3a5 Phi:3a6 Chi:3a7 Psi:3a8 Omega:3a9 alpha:3b1 beta:3b2 gamma:3b3 delta:3b4 epsilon:3b5 zeta:3b6 eta:3b7 theta:3b8 iota:3b9 kappa:3ba lambda:3bb mu:3bc nu:3bd xi:3be omicron:3bf pi:3c0 rho:3c1 sigmaf:3c2 sigma:3c3 tau:3c4 upsilon:3c5 phi:3c6 chi:3c7 psi:3c8 omega:3c9 thetasym:3d1 upsih:3d2 piv:3d6 ensp:2002 emsp:2003 thinsp:2009 zwnj:200c zwj:200d lrm:200e rlm:200f ndash:2013 mdash:2014 lsquo:2018 rsquo:2019 sbquo:201a ldquo:201c rdquo:201d bdquo:201e dagger:2020 Dagger:2021 bull:2022 hellip:2026 permil:2030 prime:2032 Prime:2033 lsaquo:2039 rsaquo:203a oline:203e frasl:2044 euro:20ac image:2111 weierp:2118 real:211c trade:2122 alefsym:2135 larr:2190 uarr:2191 rarr:2192 darr:2193 harr:2194 crarr:21b5 lArr:21d0 uArr:21d1 rArr:21d2 dArr:21d3 hArr:21d4 forall:2200 part:2202 exist:2203 empty:2205 nabla:2207 isin:2208 notin:2209 ni:220b prod:220f sum:2211 minus:2212 lowast:2217 radic:221a prop:221d infin:221e ang:2220 and:2227 or:2228 cap:2229 cup:222a int:222b there4:2234 sim:223c cong:2245 asymp:2248 ne:2260 equiv:2261 le:2264 ge:2265 sub:2282 sup:2283 nsub:2284 sube:2286 supe:2287 oplus:2295 otimes:2297 perp:22a5 sdot:22c5 lceil:2308 rceil:2309 lfloor:230a rfloor:230b lang:27e8 rang:27e9 loz:25ca spades:2660 clubs:2663 hearts:2665 diams:2666";

const LEGACY_NAMES = new Set([
  ...LATIN_1_NAMES.split(" "),
  "amp",
  "lt",
  "gt",
  "quot",
]);

const NAMED_REFERENCES: ReadonlyMap<string, string> = new Map([
  ...LATIN_1_NAMES.split(" ").map((name, index): [string, string] => [
    name,
    String.fromCodePoint(0xa0 + index),
  ]),
  ...OTHER_NAMES.split(" ").map((entry): [string, string] => {
    const [name, code] = entry.split(":") as [string, string];
    return [name, String.fromCodePoint(Number.parseInt(code, 16))];
  }),
  ["apos", "'"],
]);

const NUMERIC_REPLACEMENTS: ReadonlyMap<number, string> = new Map(
  "80:20ac 82:201a 83:192 84:201e 85:2026 86:2020 87:2021 88:2c6 89:2030 8a:160 8b:2039 8c:152 8e:17d 91:2018 92:2019 93:201c 94:201d 95:2022 96:2013 97:2014 98:2dc 99:2122 9a:161 9b:203a 9c:153 9e:17e 9f:178"
    .split(" ")
    .map((entry): [number, string] => {
      const [from, to] = entry.split(":") as [string, string];
      return [
        Number.parseInt(from, 16),
        String.fromCodePoint(Number.parseInt(to, 16)),
      ];
    }),
);

const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

function isLetter(char: string | undefined): boolean {
  return char !== undefined && /^[a-z]$/i.test(char);
}

function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\f";
}

function decodeEntity(html: string, at: number): [string, number] {
  if (html[at + 1] === "#") {
    const hex = html[at + 2] === "x" || html[at + 2] === "X";
    let end = at + (hex ? 3 : 2);
    const start = end;
    const digit = hex ? /^[0-9a-f]$/i : /^[0-9]$/;
    while (end < html.length && digit.test(html[end]!)) end++;
    if (end === start) return ["&", at + 1];
    const code = Number.parseInt(html.slice(start, end), hex ? 16 : 10);
    if (html[end] === ";") end++;
    const valid =
      code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    if (!valid) return ["\ufffd", end];
    return [NUMERIC_REPLACEMENTS.get(code) ?? String.fromCodePoint(code), end];
  }
  let end = at + 1;
  while (end < html.length && /^[0-9a-z]$/i.test(html[end]!)) end++;
  const name = html.slice(at + 1, end);
  const named = NAMED_REFERENCES.get(name);
  if (named !== undefined && html[end] === ";") return [named, end + 1];
  for (let length = name.length; length > 1; length--) {
    const prefix = name.slice(0, length);
    if (LEGACY_NAMES.has(prefix))
      return [NAMED_REFERENCES.get(prefix)!, at + 1 + length];
  }
  return ["&", at + 1];
}

function tagEnd(html: string, from: number): number {
  let quote: string | undefined;
  let afterEquals = false;
  for (let index = from; index < html.length; index++) {
    const char = html[index]!;
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === ">") return index;
    else if (afterEquals && (char === '"' || char === "'")) quote = char;
    if (char === "=") afterEquals = true;
    else if (!isSpace(char)) afterEquals = false;
  }
  return -1;
}

function tagName(html: string, from: number): string {
  let end = from;
  while (
    end < html.length &&
    !isSpace(html[end]) &&
    html[end] !== "/" &&
    html[end] !== ">"
  )
    end++;
  return html.slice(from, end).toLowerCase();
}

function rawTextEnd(html: string, from: number, name: string): number {
  for (
    let close = html.indexOf("</", from);
    close !== -1;
    close = html.indexOf("</", close + 2)
  ) {
    const after = html[close + 2 + name.length];
    if (
      html.slice(close + 2, close + 2 + name.length).toLowerCase() === name &&
      (after === undefined || after === "/" || after === ">" || isSpace(after))
    ) {
      return close;
    }
  }
  return html.length;
}

function textContent(html: string): string {
  let text = "";
  let index = 0;
  while (index < html.length) {
    const char = html[index]!;
    if (char === "&") {
      const [decoded, next] = decodeEntity(html, index);
      text += decoded;
      index = next;
    } else if (char !== "<") {
      let end = index + 1;
      while (end < html.length && html[end] !== "<" && html[end] !== "&") end++;
      text += html.slice(index, end);
      index = end;
    } else if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      if (end === -1) break;
      index = end + 3;
    } else if (isLetter(html[index + 1])) {
      const end = tagEnd(html, index + 1);
      if (end === -1) break;
      const name = tagName(html, index + 1);
      index = end + 1;
      if (RAW_TEXT_ELEMENTS.has(name)) {
        const close = rawTextEnd(html, index, name);
        text += html.slice(index, close);
        index = close;
      }
    } else if (html[index + 1] === "/" && isLetter(html[index + 2])) {
      const end = tagEnd(html, index + 2);
      if (end === -1) break;
      index = end + 1;
    } else if (
      html[index + 1] === "!" ||
      html[index + 1] === "?" ||
      html[index + 1] === "/"
    ) {
      const end = html.indexOf(">", index + 2);
      if (end === -1) break;
      index = end + 1;
    } else {
      text += "<";
      index++;
    }
  }
  return text;
}

export function unescapeHtml(html: string): string {
  if (!html.includes("<") && !html.includes("&")) return html;
  return textContent(html.replaceAll(/\r\n?/g, "\n")).replaceAll(/ {2,}/g, " ");
}
