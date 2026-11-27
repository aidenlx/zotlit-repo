import { describe, expect, it } from "vitest";

import { cleanNoteText, noteToTitle, wrapNote } from "./note.ts";

describe("note rows, as the Zotero client stores them", () => {
  it("skips a first line that holds only an opening tag, as Zotero's noteToTitle test does", () => {
    expect(
      noteToTitle("<blockquote>\n<p>Foo</p>\n</blockquote>\n<p>Bar</p>"),
    ).toBe("Foo");
  });

  it("ends the title at the first block element and turns <br> into a space", () => {
    expect(noteToTitle("<h1>Foo</h1><p>Bar</p>")).toBe("Foo");
    expect(noteToTitle("<h1>Annotations<br/>(2/18/2022)</h1><p>Foo</p>")).toBe(
      "Annotations (2/18/2022)",
    );
    expect(
      noteToTitle('<div data-schema-version="9"><p>Child note</p></div>'),
    ).toBe("Child note");
  });

  it("decodes entities and limits the title to 120 characters", () => {
    expect(noteToTitle("<p>Fish &amp; chips &#8211; &lt;b&gt;</p>")).toBe(
      "Fish & chips – <b>",
    );
    expect(noteToTitle(`<p>${"a".repeat(130)}</p>`)).toBe("a".repeat(120));
  });

  it("keeps the first line of the Robust Link note of a real Web API attachment", () => {
    const note =
      'Original URL: <a href="https://www.zotero.org/support/dev/web_api/v3/basics"\ndata-versiondate="2022-02-22">https://www.zotero.org/support/dev/web_a...</a><br>Memento URL';
    expect(noteToTitle(note)).toBe(
      "Original URL: https://www.zotero.org/support/dev/web_a... Memento URL",
    );
  });

  it("wraps the note text once and strips control characters", () => {
    expect(wrapNote("<p>Hi</p>")).toBe(
      '<div class="zotero-note znv1"><p>Hi</p></div>',
    );
    expect(wrapNote('<div class="zotero-note znv2"><p>Hi</p></div>')).toBe(
      '<div class="zotero-note znv2"><p>Hi</p></div>',
    );
    expect(cleanNoteText(" \u0007<p>Hi</p>\u0000 ")).toBe("<p>Hi</p>");
  });

  it("decodes the entities that Zotero's note editor writes and numeric ones, and keeps a < or > that starts no tag, as textContent does", () => {
    expect(
      noteToTitle(
        "<p>&quot;Fish&quot; &amp; chips&nbsp;&#8211;&#x2014; &amp x</p>",
      ),
    ).toBe('"Fish" & chips\u00a0–— & x');
    expect(noteToTitle("<p>x < y and y > z</p>")).toBe("x < y and y > z");
    expect(noteToTitle("<p>a<!-- hidden -->b</p>")).toBe("ab");
  });

  it("reads tags as the HTML parser of the client does, for every attribute value and an unclosed tag", () => {
    expect(noteToTitle('<p title="a>b">Foo</p><p>Bar</p>')).toBe("Foo");
    expect(noteToTitle("<p data-x='1 > 0'>One</p>")).toBe("One");
    expect(noteToTitle("<p>Foo <b")).toBe("Foo ");
    expect(noteToTitle('<p>Foo <img src="x')).toBe("Foo ");
    expect(noteToTitle("<p>a</>b</ x>c</p>")).toBe("abc");
    expect(noteToTitle("<p>a <3 b</p>")).toBe("a <3 b");
  });

  it("decodes the named references of HTML 4 with their semicolon, and a legacy name without it, as the HTML parser does", () => {
    expect(
      noteToTitle(
        "<p>Caf&eacute; &mdash; a&nbsp;b &alpha;&Omega; &hellip;</p>",
      ),
    ).toBe("Café — a\u00a0b αΩ …");
    expect(noteToTitle("<p>&Eacute;&eacute; &EACUTE;</p>")).toBe("Éé &EACUTE;");
    expect(noteToTitle("<p>&lang;x&rang;</p>")).toBe("\u27e8x\u27e9");
    expect(noteToTitle("<p>&unknown; &notin; &notit; &copy 2024</p>")).toBe(
      "&unknown; ∉ ¬it; © 2024",
    );
  });

  it.each([
    [0x80, "\u20ac"],
    [0x81, "\u0081"],
    [0x82, "\u201a"],
    [0x83, "\u0192"],
    [0x84, "\u201e"],
    [0x85, "\u2026"],
    [0x86, "\u2020"],
    [0x87, "\u2021"],
    [0x88, "\u02c6"],
    [0x89, "\u2030"],
    [0x8a, "\u0160"],
    [0x8b, "\u2039"],
    [0x8c, "\u0152"],
    [0x8d, "\u008d"],
    [0x8e, "\u017d"],
    [0x8f, "\u008f"],
    [0x90, "\u0090"],
    [0x91, "\u2018"],
    [0x92, "\u2019"],
    [0x93, "\u201c"],
    [0x94, "\u201d"],
    [0x95, "\u2022"],
    [0x96, "\u2013"],
    [0x97, "\u2014"],
    [0x98, "\u02dc"],
    [0x99, "\u2122"],
    [0x9a, "\u0161"],
    [0x9b, "\u203a"],
    [0x9c, "\u0153"],
    [0x9d, "\u009d"],
    [0x9e, "\u017e"],
    [0x9f, "\u0178"],
  ])(
    "decodes the numeric reference %i through the replacement table of the HTML parser",
    (code, char) => {
      expect(noteToTitle(`<p>a&#${code};b</p>`)).toBe(`a${char}b`);
      expect(noteToTitle(`<p>a&#x${code.toString(16)};b</p>`)).toBe(
        `a${char}b`,
      );
    },
  );

  it("gives U+FFFD for a numeric reference to 0, a surrogate or a code point above U+10FFFF, and keeps a control character or a noncharacter, as the HTML parser does", () => {
    for (const code of [
      "0",
      "xd800",
      "xdfff",
      "x110000",
      "99999999999999999999",
    ]) {
      expect(noteToTitle(`<p>a&#${code};b</p>`)).toBe("a\ufffdb");
    }
    expect(noteToTitle("<p>a&#1;&#x7f;&#xfdd0;&#xfffe;b</p>")).toBe(
      "a\u0001\u007f\ufdd0\ufffeb",
    );
  });

  it("keeps the text of script and style elements and of noscript content, as textContent does", () => {
    expect(noteToTitle('<script>var a = "<b>";</script>')).toBe(
      'var a = "<b>";',
    );
    expect(noteToTitle("<style>p{}</style>Foo")).toBe("p{}Foo");
    expect(noteToTitle("<noscript><b>x</b></noscript>")).toBe("x");
  });

  it("turns a carriage return into a line break, as the parser does", () => {
    expect(noteToTitle("<span>a\r\nb</span>")).toBe("a");
    expect(noteToTitle("<span>a\rb</span>")).toBe("a");
  });

  it("reads a note nested 50,000 elements deep", () => {
    const depth = 50_000;
    const note = `<p>${"<span>".repeat(depth)}Deep &amp; inner${"</span>".repeat(depth)}</p><p>After</p>`;
    expect(noteToTitle(note)).toBe("Deep & inner");
  });
});
