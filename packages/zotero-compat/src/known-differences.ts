export type Port =
  | "annotationValue"
  | "attachmentLastRead"
  | "attachmentPath"
  | "isoToSql"
  | "noteToTitle"
  | "strToMultipart";

export type Value = string | number | null;

export interface KnownDifference {
  readonly port: Port;
  readonly importer?: string;
  readonly args: readonly unknown[];
  readonly client: Value | { readonly outcome: string };
  readonly result: Value;
  readonly acceptedBy: string;
  readonly reason: string;
}

const BROWSER_PARSER =
  "the client reads the note with the HTML parser of its browser";
const ACCEPTED = "maintainer, #310";

export const KNOWN_DIFFERENCES: readonly KnownDifference[] = [
  {
    port: "noteToTitle",
    args: ["<p>a &NotEqualTilde; b</p>"],
    client: "a \u{2242}\u{338} b",
    result: "a &NotEqualTilde; b",
    acceptedBy: "maintainer, #305",
    reason: `a character name that only HTML 5 has; ${BROWSER_PARSER}`,
  },
  {
    port: "noteToTitle",
    args: ["<textarea><b>x</b> &amp;</textarea>"],
    client: "<b>x</b> &",
    result: "x &",
    acceptedBy: "maintainer, #305",
    reason: `malformed HTML (RCDATA element); ${BROWSER_PARSER}`,
  },
  {
    port: "noteToTitle",
    args: ["<title><i>T</i></title>"],
    client: "<i>T</i>",
    result: "T",
    acceptedBy: "maintainer, #305",
    reason: `malformed HTML (RCDATA element); ${BROWSER_PARSER}`,
  },
  {
    port: "noteToTitle",
    args: ["<xmp><b></xmp><plaintext><i>"],
    client: "<b><i>",
    result: "",
    acceptedBy: "maintainer, #305",
    reason: `malformed HTML (raw text elements); ${BROWSER_PARSER}`,
  },
  {
    port: "noteToTitle",
    args: ["<template><p>Hidden</p></template>Shown"],
    client: "Shown",
    result: "Hidden",
    acceptedBy: "maintainer, #305",
    reason: `malformed HTML (template content); ${BROWSER_PARSER}`,
  },
  {
    port: "noteToTitle",
    args: ["<table><tr><td>a</td></tr>b</table>"],
    client: "ba",
    result: "ab",
    acceptedBy: "maintainer, #305",
    reason: `malformed HTML (text in a table moves before it); ${BROWSER_PARSER}`,
  },
  {
    port: "strToMultipart",
    args: ["\u{560}juin 2010", { currentYear: 2026, locale: "fr-FR" }],
    client: "2010-06-00 \u{560}juin 2010",
    result: "2010-00-00 \u{560}juin 2010",
    acceptedBy: "maintainer, #305",
    reason:
      "a letter that Unicode added after version 9, directly before a month name: the letter class is the runtime's, and the client's is the Unicode 9 table of XRegExp 3.2.0 (243 code points of the Basic Multilingual Plane differ)",
  },
  {
    port: "isoToSql",
    args: ["0099-03-04T00:00:00Z", "UTC"],
    client: "1999-03-04 00:00:00",
    result: "0099-03-04 00:00:00",
    acceptedBy: ACCEPTED,
    reason:
      "a dateAdded or dateModified year from 0 to 99 only: the dateAdded and dateModified setter of the client reads the SQL date back with Date.UTC, which reads such a year as 1900 + year",
  },
  {
    port: "attachmentLastRead",
    args: ["0x1A"],
    client: 26,
    result: 0,
    acceptedBy: ACCEPTED,
    reason:
      "the client parses the read time with no radix (item.js:5757), so a hexadecimal text is read as hexadecimal; the API sends integers",
  },
  {
    port: "attachmentLastRead",
    args: [" 0x10 "],
    client: 16,
    result: 0,
    acceptedBy: ACCEPTED,
    reason:
      "the client parses the read time with no radix (item.js:5757), so a hexadecimal text is read as hexadecimal; the API sends integers",
  },
  {
    port: "attachmentLastRead",
    args: [0.5],
    client: null,
    result: 0,
    acceptedBy: ACCEPTED,
    reason:
      'a read time that parses to 0: the client saves `lastRead || null` (item.js:2216) and stores no read time; the same for the text "0". The integer 0 gives no read time in both. The API sends integers',
  },
  {
    port: "attachmentLastRead",
    importer: "writeAttachment",
    args: ["soon"],
    client: { outcome: "keeps the read time that it has" },
    result: null,
    acceptedBy: ACCEPTED,
    reason:
      "an update with a read time that is not an integer, for a personal attachment that has a read time: the client leaves out the field and keeps the old value (item.js:5756, item.js:5995), and the importer of the replica writes no read time; the API sends integers. packages/db/src/replica/apply.test.ts holds the importer's result",
  },
  {
    port: "attachmentPath",
    args: ["imported_file", { path: "storage:paper.pdf" }],
    client: "storage:paper.pdf",
    result: null,
    acceptedBy: ACCEPTED,
    reason:
      "a stored file with a path and no file name: fromJSON sets the path as given (item.js:5804); the API sends the file name of a stored file",
  },
  {
    port: "attachmentPath",
    args: ["linked_file", { path: "/Users/a/Base/paper.pdf" }],
    client: "attachments:paper.pdf",
    result: "/Users/a/Base/paper.pdf",
    acceptedBy: ACCEPTED,
    reason:
      "a linked file in the base directory of the client: with the local preference saveRelativeAttachmentPath and the base directory /Users/a/Base, the client stores the path relative to it (item.js:3687). The server stores and sends the path as the writing client gave it, so a normal library has both forms; the replica stores the path as sent, and the adapter that reads attachment files resolves it (#307)",
  },
  {
    port: "attachmentPath",
    args: ["linked_url", { filename: "a.pdf" }],
    client: { outcome: "refuses the item" },
    result: null,
    acceptedBy: ACCEPTED,
    reason:
      "a file name on a link: the filename setter of the client throws (item.js:3630), so the item is not saved; the replica stores the link with no path",
  },
  {
    port: "attachmentPath",
    args: ["linked_file", { path: "/Users/a/b.pdf", filename: "b.pdf" }],
    client: { outcome: "refuses the item" },
    result: "/Users/a/b.pdf",
    acceptedBy: ACCEPTED,
    reason:
      "a file name on a linked file: the filename setter of the client throws (item.js:3630), so the item is not saved; the replica stores the linked file with its path",
  },
  {
    port: "annotationValue",
    args: [5],
    client: "5",
    result: null,
    acceptedBy: ACCEPTED,
    reason:
      "an annotation value that is a number, such as a page label: the annotation setter of the client normalises only a text (item.js:4499) and keeps the number, and the save writes it into a TEXT column (item.js:2290, userdata.sql:238), which stores the text 5; the server accepts only a text for the text, comment, author name and page label of an annotation, and a colour or sort index is a number only when a client other than Zotero wrote it",
  },
];
