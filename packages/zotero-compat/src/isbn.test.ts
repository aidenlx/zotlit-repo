import { describe, expect, it } from "vitest";

import { cleanISBN, hyphenateISBN, hyphenateIsbnField } from "./isbn.ts";

describe("ISBN values, as the Zotero client stores them", () => {
  it("hyphenates an ISBN-13 as Zotero's sync test expects", () => {
    expect(hyphenateIsbnField("9780335220069")).toBe("978-0-335-22006-9");
    expect(hyphenateIsbnField("978-0-335-22006-9")).toBe("978-0-335-22006-9");
  });

  it("hyphenates the ISBNs of Zotero's duplicate and lookup tests", () => {
    expect(hyphenateIsbnField("0134685997")).toBe("0-13-468599-7");
    expect(hyphenateIsbnField("9780134685991")).toBe("978-0-13-468599-1");
    expect(hyphenateIsbnField("0838985890")).toBe("0-8389-8589-0");
    expect(hyphenateIsbnField("978-0838985892")).toBe("978-0-8389-8589-2");
    expect(hyphenateIsbnField("1421402831")).toBe("1-4214-0283-1");
    expect(hyphenateIsbnField("9780306406157")).toBe("978-0-306-40615-7");
  });

  it("keeps an ISBN-10 short, reads the check digit X, and hyphenates 979 groups", () => {
    expect(hyphenateIsbnField("080442957x")).toBe("0-8044-2957-X");
    expect(hyphenateIsbnField("9791034304233")).toBe("979-10-343-0423-3");
    expect(hyphenateIsbnField("9798812345679")).toBe("979-8-8123-4567-9");
  });

  it("hyphenates each ISBN of a list and joins them with one space", () => {
    expect(hyphenateIsbnField("9780306406157, 0134685997;1421402831")).toBe(
      "978-0-306-40615-7 0-13-468599-7 1-4214-0283-1",
    );
  });

  it("keeps the value as given when one ISBN of it is invalid or outside the ranges", () => {
    for (const value of [
      "9780306406158",
      "9780306406157 0134685998",
      "9791200000006",
      "9780306406157 (pbk.)",
      "not an ISBN",
    ]) {
      expect(hyphenateIsbnField(value)).toBe(value);
    }
  });

  it("cleans an ISBN as Zotero.Utilities.cleanISBN does", () => {
    expect(cleanISBN("ISBN 978‐0‑306 40615 7")).toBe("9780306406157");
    expect(cleanISBN("x 9780306406158 0134685997")).toBe("0134685997");
    expect(cleanISBN("9780306406158", true)).toBe("9780306406158");
    expect(cleanISBN("12345")).toBe(false);
    expect(hyphenateISBN("12345")).toBe("");
  });

  it.each([
    ["", false, false],
    ["Random String 123", false, false],
    ["1234X67890", false, false],
    ["987123456789X", false, false],
    ["1234567890", false, false],
    ["9871234567890", false, false],
    ["123456789X", false, "123456789X"],
    ["123456789x", false, "123456789X"],
    ["9781234567897", false, "9781234567897"],
    ["9791843123391", false, "9791843123391"],
    ["ISBN 9781234567897", false, "9781234567897"],
    ["ISBN:9781234567897", false, "9781234567897"],
    ["9781234567897 ISBN13", false, "9781234567897"],
    ["9781234567897(ISBN13)", false, "9781234567897"],
    ["ISBN13:9781234567897 (print)", false, "9781234567897"],
    ["978 9781234567 897", false, "9781234567897"],
    ["9781234567897, 9791843123391", false, "9781234567897"],
    ["123456789X, 0199535922", false, "123456789X"],
    ["123456789X 9781234567897", false, "123456789X"],
    ["9781234567897 123456789X", false, "9781234567897"],
    ["1234567890 9781234567897", false, "9781234567897"],
    ["1239781234567897", false, false],
    ["9781234567897123", false, false],
    ["1239781234567897123", false, false],
    [
      "<b>ISBN</b>:978-1 234\xA056789 - 7(print)\n<b>ISBN-10</b>:123\x2D456789X (print)",
      false,
      "9781234567897",
    ],
    ["9781234567890", true, "9781234567890"],
    ["1234567890", true, "1234567890"],
    ["1234567890 9781234567897", true, "1234567890"],
    ["9781234567890 123456789X", true, "9781234567890"],
    ["", true, false],
    ["Random String 123", true, false],
    ["1234X67890", true, false],
    ["123456789Y", true, false],
    ["987123456789X", true, false],
    ["1239781234567897", true, false],
    ["9781234567897123", true, false],
    ["1239781234567897123", true, false],
  ] as const)(
    "cleans %j (dontValidate %s) as Zotero's cleanISBN test expects",
    (input, dontValidate, cleaned) => {
      expect(cleanISBN(input, dontValidate)).toBe(cleaned);
    },
  );

  it("strips the dashes and spaces inside an ISBN and no other character, as Zotero's cleanISBN test expects", () => {
    const ignored =
      "\x2D\xAD\u2010\u2011\u2012\u2013\u2014\u2015\u2043\u2212" +
      " \xA0\r\n\t\x0B\x0C\u1680\u2000\u2001\u2002\u2003\u2004\u2005" +
      "\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF";
    for (const char of ignored) {
      expect(cleanISBN(`9781${char}234567897`)).toBe("9781234567897");
    }
    expect(cleanISBN(`9781${ignored}234567897`)).toBe("9781234567897");
    const isbnChars = `${ignored}1234567890`;
    for (let code = 1; code < 1327; code++) {
      const char = String.fromCharCode(code);
      if (isbnChars.includes(char)) continue;
      expect(cleanISBN(`9781${char}234567897`)).toBe(false);
    }
  });
});
