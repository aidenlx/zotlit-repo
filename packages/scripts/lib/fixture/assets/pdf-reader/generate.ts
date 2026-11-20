import type { PdfObject } from "#fixture/assets/pdf-writer";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildPdf, contentStream } from "#fixture/assets/pdf-writer";

const SCALE = 2.8346;
const CJK = "示例文字用于复现表单对象";
const LATIN = "Sample placeholder text ";
const BOX = "[ 8.5 8.5 603.78 816.38 ]";
const MOCK_ID = "<ca6a3f8e0dbe5b01a163426bd5653560>";

interface Run {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly length: number;
  readonly cjk: boolean;
  readonly direct: boolean;
}

const RUNS: readonly (readonly [
  number,
  number,
  number,
  number,
  0 | 1,
  0 | 1,
])[] = [
  [325.87, 744.6, 11.76, 2, 1, 0],
  [349.86, 744.6, 11.76, 1, 1, 0],
  [361.86, 744.6, 11.76, 1, 1, 0],
  [367.87, 744.6, 11.76, 14, 1, 0],
  [139.86, 665.81, 23.52, 14, 1, 0],
  [215.22, 623.28, 15.68, 1, 0, 0],
  [231.2, 623.28, 15.68, 11, 1, 0],
  [222.03, 573.96, 15.68, 1, 1, 0],
  [254.75, 573.96, 15.68, 1, 1, 0],
  [287.47, 573.96, 15.68, 3, 1, 0],
  [353.63, 573.96, 15.68, 3, 1, 0],
  [403.01, 581.29, 8.82, 1, 0, 0],
  [138.66, 528.88, 11.76, 2, 1, 0],
  [164.19, 528.88, 11.76, 1, 1, 0],
  [170.96, 528.88, 11.76, 27, 1, 0],
  [114.66, 509.84, 11.76, 15, 1, 0],
  [305.4, 509.84, 11.76, 1, 1, 0],
  [318.12, 509.84, 11.76, 15, 1, 0],
  [508.86, 509.84, 11.76, 1, 1, 0],
  [114.66, 490.81, 11.76, 20, 1, 0],
  [372.86, 490.81, 11.76, 1, 1, 0],
  [379.77, 490.81, 11.76, 4, 1, 0],
  [431.4, 490.81, 11.76, 1, 1, 0],
  [438.31, 490.81, 11.76, 6, 1, 0],
  [114.66, 471.77, 11.76, 29, 1, 0],
  [483.43, 471.77, 11.76, 1, 1, 0],
  [490.15, 471.77, 11.76, 2, 1, 0],
  [114.66, 452.74, 11.76, 9, 1, 0],
  [230.85, 452.74, 11.76, 1, 1, 0],
  [243.76, 452.74, 11.76, 7, 1, 0],
  [334.13, 452.74, 11.76, 1, 1, 0],
  [341.04, 452.74, 11.76, 7, 1, 0],
  [431.4, 452.74, 11.76, 1, 1, 0],
  [438.31, 452.74, 11.76, 6, 1, 0],
  [114.66, 433.7, 11.76, 15, 1, 0],
  [308.32, 433.7, 11.76, 1, 1, 0],
  [315.22, 433.7, 11.76, 5, 1, 0],
  [379.77, 433.7, 11.76, 1, 1, 0],
  [386.68, 433.7, 11.76, 10, 1, 0],
  [114.66, 414.67, 11.76, 4, 1, 0],
  [165.44, 414.67, 11.76, 1, 1, 0],
  [172.13, 414.67, 11.76, 14, 1, 0],
  [349.86, 414.67, 11.76, 1, 1, 0],
  [356.54, 414.67, 11.76, 5, 1, 0],
  [420.01, 414.67, 11.76, 1, 1, 0],
  [426.7, 414.67, 11.76, 7, 1, 0],
  [114.66, 395.63, 11.76, 6, 1, 0],
  [190.96, 395.63, 11.76, 1, 1, 0],
  [197.68, 395.63, 11.76, 25, 1, 0],
  [114.66, 376.6, 11.76, 7, 1, 0],
  [167.22, 376.6, 11.76, 1, 1, 0],
  [180.36, 376.6, 11.76, 13, 1, 0],
  [272.34, 376.6, 11.76, 1, 1, 0],
  [279.48, 376.6, 11.76, 35, 1, 0],
  [114.66, 357.56, 11.76, 1, 1, 0],
  [127.38, 357.56, 11.76, 1, 1, 0],
  [134.1, 357.56, 11.76, 20, 1, 0],
  [388.42, 357.56, 11.76, 1, 1, 0],
  [401.13, 357.56, 11.76, 9, 1, 0],
  [114.66, 338.53, 11.76, 3, 1, 0],
  [153.39, 338.53, 11.76, 1, 1, 0],
  [160.3, 338.53, 11.76, 18, 1, 0],
  [392.68, 338.53, 11.76, 1, 1, 0],
  [399.59, 338.53, 11.76, 9, 1, 0],
  [114.66, 319.49, 11.76, 6, 1, 0],
  [189.88, 319.49, 11.76, 1, 1, 0],
  [138.66, 300.46, 11.76, 3, 1, 0],
  [177.33, 300.46, 11.76, 1, 1, 0],
  [184.22, 300.46, 11.76, 7, 1, 0],
  [286.43, 300.46, 11.76, 4, 1, 0],
  [349.98, 300.46, 11.76, 5, 1, 0],
  [426.42, 300.46, 11.76, 4, 1, 0],
  [489.98, 300.46, 11.76, 2, 1, 0],
  [114.66, 281.42, 11.76, 2, 1, 0],
  [271.84, 233.5, 13.72, 1, 1, 0],
  [286.47, 233.5, 13.72, 1, 1, 0],
  [301.1, 233.5, 13.72, 1, 1, 0],
  [343.73, 233.5, 13.72, 1, 1, 0],
  [117.66, 206.02, 11.76, 11, 1, 0],
  [259.06, 206.02, 11.76, 1, 1, 0],
  [259.91, 206.02, 11.76, 1, 0, 0],
  [272.77, 206.02, 11.76, 14, 1, 0],
  [452.73, 206.02, 11.76, 1, 1, 0],
  [459.59, 206.02, 11.76, 6, 1, 0],
  [93.66, 187.72, 11.76, 2, 1, 0],
  [119.22, 187.72, 11.76, 1, 1, 0],
  [126.01, 187.72, 11.76, 6, 1, 0],
  [202.71, 187.72, 11.76, 1, 1, 0],
  [209.5, 187.72, 11.76, 13, 1, 0],
  [375.68, 187.72, 11.76, 1, 1, 0],
  [382.46, 187.72, 11.76, 11, 1, 0],
  [523.06, 187.72, 11.76, 1, 0, 0],
  [529.84, 187.72, 11.76, 1, 1, 0],
  [114.65, 153.8, 10.29, 1, 0, 0],
  [130.99, 153.8, 10.29, 2, 1, 0],
  [153.18, 153.8, 10.29, 1, 1, 0],
  [159.03, 153.8, 10.29, 5, 1, 0],
  [214.5, 153.8, 10.29, 1, 1, 0],
  [220.35, 153.8, 10.29, 9, 1, 0],
  [320.2, 153.8, 10.29, 1, 1, 0],
  [326.05, 153.8, 10.29, 4, 1, 0],
  [370.43, 153.8, 10.29, 1, 1, 0],
  [376.27, 153.8, 10.29, 15, 0, 0],
  [449.16, 153.8, 10.29, 1, 0, 0],
  [451.91, 153.8, 10.29, 3, 0, 0],
  [469.29, 153.8, 10.29, 1, 1, 0],
  [475.12, 153.8, 10.29, 3, 1, 0],
  [504.76, 153.8, 10.29, 1, 1, 0],
  [514.25, 153.8, 10.29, 2, 1, 0],
  [93.65, 137, 10.29, 2, 1, 0],
  [114.59, 137, 10.29, 1, 1, 0],
  [122.21, 137, 10.29, 1, 1, 0],
  [128.23, 137, 10.29, 2, 1, 0],
  [150.78, 137, 10.29, 1, 1, 0],
  [156.8, 137, 10.29, 9, 1, 0],
  [258.24, 137, 10.29, 1, 1, 0],
  [264.26, 137, 10.29, 4, 1, 0],
  [309.35, 137, 10.29, 1, 1, 0],
  [315.37, 137, 10.29, 9, 0, 0],
  [358.52, 137, 10.29, 3, 0, 0],
  [374.27, 137, 10.29, 1, 0, 0],
  [377.2, 137, 10.29, 3, 0, 0],
  [394.58, 137, 10.29, 1, 1, 0],
  [400.59, 137, 10.29, 3, 1, 0],
  [434.4, 137, 10.29, 1, 1, 0],
  [440.42, 137, 10.29, 5, 1, 0],
  [496.78, 137, 10.29, 1, 1, 0],
  [502.8, 137, 10.29, 3, 1, 0],
  [93.65, 120.2, 10.29, 11, 1, 0],
  [169.42, 120.2, 10.29, 1, 1, 0],
  [176.77, 120.2, 10.29, 7, 1, 0],
  [227.29, 120.2, 10.29, 1, 1, 0],
  [234.64, 120.2, 10.29, 11, 0, 0],
  [285.95, 120.2, 10.29, 3, 0, 0],
  [301.7, 120.2, 10.29, 1, 0, 0],
  [305.98, 120.2, 10.29, 3, 0, 0],
  [323.35, 120.2, 10.29, 1, 1, 0],
  [335.98, 120.2, 10.29, 31, 1, 0],
  [90, 103.4, 10.29, 1, 1, 0],
  [99.37, 103.4, 10.29, 2, 0, 0],
  [109.87, 103.4, 10.29, 3, 0, 0],
  [130.29, 103.4, 10.29, 3, 0, 0],
  [144.91, 103.4, 10.29, 1, 1, 0],
  [152.48, 103.4, 10.29, 19, 1, 0],
  [362.01, 103.4, 10.29, 1, 1, 0],
  [371.39, 103.4, 10.29, 4, 0, 0],
  [392.39, 103.4, 10.29, 3, 0, 0],
  [413.39, 103.4, 10.29, 3, 0, 0],
  [428.01, 103.4, 10.29, 1, 1, 0],
  [435.58, 103.4, 10.29, 3, 1, 0],
  [469.24, 103.4, 10.29, 1, 1, 0],
  [480.46, 103.4, 10.29, 5, 1, 0],
  [93.65, 86.6, 10.29, 2, 0, 0],
  [104.62, 86.6, 10.29, 1, 1, 0],
  [115.59, 86.6, 10.29, 13, 1, 0],
  [258.23, 86.6, 10.29, 1, 1, 0],
  [263.95, 86.6, 10.29, 4, 1, 0],
  [307.82, 86.6, 10.29, 1, 1, 0],
  [507.28, 57.82, 11.76, 3, 0, 0],
  [114.66, 266.78, 9, 37, 0, 1],
];

const runs: readonly Run[] = RUNS.map(([x, y, size, length, cjk, direct]) => ({
  x,
  y,
  size,
  length,
  cjk: cjk === 1,
  direct: direct === 1,
}));

function placeholder(run: Run): string {
  const source = (run.cjk ? CJK : LATIN).split("");
  return Array.from(
    { length: run.length },
    (_, index) => source[index % source.length],
  ).join("");
}

function utf16Hex(text: string): string {
  return text
    .split("")
    .map((char) => char.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("")
    .toUpperCase();
}

function runOperators(drawn: readonly Run[]): string {
  return drawn
    .map((run) => {
      const k = (run.size / SCALE).toFixed(4);
      const text = placeholder(run);
      const shown = run.cjk ? `<${utf16Hex(text)}>` : `(${text})`;
      return `q ${SCALE} 0 0 -${SCALE} ${run.x} ${run.y} cm 0 0 0 rg BT /${run.cjk ? "F1" : "F2"} 1 Tf ${k} 0 0 -${k} 0 0 Tm ${shown} Tj ET Q`;
    })
    .join("\n");
}

function mockStream(content: string, entries = ""): PdfObject {
  return `<< ${entries}/Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
}

function mockPdf(objects: readonly PdfObject[]): Buffer {
  const header = "%PDF-1.3\n%2033\n";
  const offsets: number[] = [];
  let body = "";
  let offset = header.length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const text = `${index + 1} 0 obj\n${object}\nendobj\n`;
    body += text;
    offset += Buffer.byteLength(text, "latin1");
  });
  const size = objects.length + 1;
  const xref = [
    "xref",
    `0 ${size}`,
    "0000000000 65535 f ",
    ...offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n `),
  ].join("\n");
  const trailer = `trailer << /Info 2 0 R /Root 1 0 R /Size ${size} /ID [${MOCK_ID}${MOCK_ID}] >>\nstartxref\n${offset}\n%%EOF\n`;
  return Buffer.from(`${header}${body}${xref}\n${trailer}`, "latin1");
}

const CATALOG = "<< /Pages 3 0 R /Type /Catalog >>";
const INFO = "<< /Producer (zotlit#2033 mock of a ReaderEx_DIS page layout) >>";
const PAGES = "<< /Count 1 /Kids [ 4 0 R ] /Type /Pages >>";
const STAMP = mockStream(
  "q BT 0 0 0 rg 114.66 266.78 TD /TP1 9 Tf (DOI:10.0000/mock.2033) Tj ET Q",
);
const TIMES = "<< /BaseFont /Times-Roman /Subtype /Type1 /Type /Font >>";
const descriptor =
  "<< /Ascent 880 /CapHeight 880 /Descent -120 /Flags 6 /FontBBox [ -25 -254 1000 880 ] /FontName /STSong-Light /ItalicAngle 0 /StemV 93 /Type /FontDescriptor >>";

function songType0(descendant: number): PdfObject {
  return `<< /BaseFont /STSong-Light /DescendantFonts [ ${descendant} 0 R ] /Encoding /UniGB-UCS2-H /Subtype /Type0 /Type /Font >>`;
}

function songCid(fontDescriptor: number): PdfObject {
  return `<< /BaseFont /STSong-Light /CIDSystemInfo << /Ordering (GB1) /Registry (Adobe) /Supplement 2 >> /DW 1000 /FontDescriptor ${fontDescriptor} 0 R /Subtype /CIDFontType0 /Type /Font >>`;
}

const placed = runOperators(runs.filter((run) => !run.direct));

const mockForm = mockPdf([
  CATALOG,
  INFO,
  PAGES,
  `<< /Contents [ 5 0 R 6 0 R ] /CropBox ${BOX} /MediaBox ${BOX} /Parent 3 0 R /Resources << /Font << /TP1 7 0 R >> /XObject << /Xf131 8 0 R >> >> /Rotate 0 /Type /Page >>`,
  mockStream("q\nBT\n44.5 780.38 Td\nET\nQ\nq 1 0 0 1 8.5 8.5 cm /Xf131 Do Q"),
  STAMP,
  TIMES,
  mockStream(
    `q\n${placed}\nQ`,
    `/BBox ${BOX} /Matrix [ 1 0 0 1 -8.5 -8.5 ] /Resources << /Font << /F1 9 0 R /F2 7 0 R >> >> /Subtype /Form /Type /XObject `,
  ),
  songType0(10),
  songCid(11),
  descriptor,
]);

const mockDirect = mockPdf([
  CATALOG,
  INFO,
  PAGES,
  `<< /Contents [ 5 0 R 6 0 R ] /CropBox ${BOX} /MediaBox ${BOX} /Parent 3 0 R /Resources << /Font << /F1 7 0 R /F2 8 0 R /TP1 8 0 R >> >> /Rotate 0 /Type /Page >>`,
  mockStream(`q\n${placed}\nQ`),
  STAMP,
  songType0(9),
  TIMES,
  songCid(10),
  descriptor,
]);

function bits(pattern: string): Buffer {
  const padded = pattern.padEnd(Math.ceil(pattern.length / 8) * 8, "0");
  return Buffer.from(
    Array.from({ length: padded.length / 8 }, (_, index) =>
      Number.parseInt(padded.slice(index * 8, index * 8 + 8), 2),
    ),
  );
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function segment(number: number, type: number, data: Buffer): Buffer {
  return Buffer.concat([
    uint32(number),
    Buffer.from([type, 0x00, 0x01]),
    uint32(data.length),
    data,
  ]);
}

const IMAGE_SIZE = 64;
const SQUARE_START = 16;
const SQUARE_END = 48;

function squareMmr(): Buffer {
  const whiteRow = "1";
  const firstBlackRow = ["001", "101010", "000001101010", "1"].join("");
  const sameRow = "111";
  const closingRow = ["0001", "1"].join("");
  const rows = Array.from({ length: IMAGE_SIZE }, (_, row) => {
    if (row < SQUARE_START || row > SQUARE_END) return whiteRow;
    if (row === SQUARE_START) return firstBlackRow;
    if (row < SQUARE_END) return sameRow;
    return closingRow;
  });
  const endOfBlock = "000000000001000000000001";
  return bits(rows.join("") + endOfBlock);
}

function jbig2Square(): Buffer {
  const pageInformation = Buffer.concat([
    uint32(IMAGE_SIZE),
    uint32(IMAGE_SIZE),
    uint32(0),
    uint32(0),
    Buffer.from([0x01, 0x00, 0x00]),
  ]);
  const region = Buffer.concat([
    uint32(IMAGE_SIZE),
    uint32(IMAGE_SIZE),
    uint32(0),
    uint32(0),
    Buffer.from([0x00, 0x01]),
    squareMmr(),
  ]);
  return Buffer.concat([
    segment(0, 48, pageInformation),
    segment(1, 38, region),
    segment(2, 49, Buffer.alloc(0)),
  ]);
}

function uint16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
}

function marker(code: number, body: Buffer): Buffer {
  return Buffer.concat([uint16(code), uint16(body.length + 2), body]);
}

function jpxGray(): Buffer {
  const tileData = Buffer.from([0x00]);
  const siz = marker(
    0xff51,
    Buffer.concat([
      uint16(0),
      uint32(IMAGE_SIZE),
      uint32(IMAGE_SIZE),
      uint32(0),
      uint32(0),
      uint32(IMAGE_SIZE),
      uint32(IMAGE_SIZE),
      uint32(0),
      uint32(0),
      uint16(1),
      Buffer.from([0x07, 0x01, 0x01]),
    ]),
  );
  const cod = marker(
    0xff52,
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x04, 0x04, 0x00, 0x01]),
  );
  const qcd = marker(0xff5c, Buffer.from([0x40, 0x40]));
  const sot = marker(
    0xff90,
    Buffer.concat([
      uint16(0),
      uint32(12 + 2 + tileData.length),
      Buffer.from([0x00, 0x01]),
    ]),
  );
  return Buffer.concat([
    uint16(0xff4f),
    siz,
    cod,
    qcd,
    sot,
    uint16(0xff93),
    tileData,
    uint16(0xffd9),
  ]);
}

function binaryStream(data: Buffer, entries: string): PdfObject {
  return `<< ${entries} /Length ${data.length} >>\nstream\n${data.toString("latin1")}\nendstream`;
}

function imagePdf(image: PdfObject): Buffer {
  return buildPdf(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
      contentStream("q 160 0 0 160 20 20 cm /Im1 Do Q"),
      image,
    ],
    { header: "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", finalNewline: true },
  );
}

const jbig2 = imagePdf(
  binaryStream(
    jbig2Square(),
    `/Type /XObject /Subtype /Image /Width ${IMAGE_SIZE} /Height ${IMAGE_SIZE} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /JBIG2Decode`,
  ),
);

const jpx = imagePdf(
  binaryStream(
    jpxGray(),
    `/Type /XObject /Subtype /Image /Width ${IMAGE_SIZE} /Height ${IMAGE_SIZE} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JPXDecode`,
  ),
);

const NAVIGATION_PAGES = 8;
const NAVIGATION_LINES = 30;
const navigationPage = (index: number) => 6 + 2 * index;

function navigationContent(page: number): string {
  const lines = Array.from(
    { length: NAVIGATION_LINES },
    (_, line) =>
      `BT /F1 11 Tf 72 ${700 - 20 * line} Td (Page ${page} line ${line + 1}: the quick brown fox jumps over the lazy dog.) Tj ET`,
  );
  return [`BT /F1 24 Tf 72 740 Td (Page ${page}) Tj ET`, ...lines].join("\n");
}

const navigation = buildPdf(
  [
    "<< /Type /Catalog /Pages 2 0 R /Dests 3 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: NAVIGATION_PAGES }, (_, index) => `${navigationPage(index)} 0 R`).join(" ")}] /Count ${NAVIGATION_PAGES} >>`,
    `<< /chapter-three [${navigationPage(2)} 0 R /XYZ 0 792 null] /chapter-six [${navigationPage(5)} 0 R /FitH 400] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /Annot /Subtype /Text /Rect [400 600 424 624] /Contents (Note on page four) /P ${navigationPage(3)} 0 R >>`,
    ...Array.from({ length: NAVIGATION_PAGES }, (_, index) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >>${index === 3 ? " /Annots [5 0 R]" : ""} /Contents ${navigationPage(index) + 1} 0 R >>`,
      contentStream(navigationContent(index + 1)),
    ]).flat(),
  ],
  { header: "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", finalNewline: true },
);

const STANDARD_FONTS = [
  "Times-Roman",
  "Times-Bold",
  "Times-Italic",
  "Times-BoldItalic",
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
  "Courier",
  "Courier-Bold",
  "Courier-Oblique",
  "Courier-BoldOblique",
  "Symbol",
  "ZapfDingbats",
] as const;

const standardFonts = buildPdf(
  [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << ${STANDARD_FONTS.map((_, index) => `/F${index + 1} ${index + 5} 0 R`).join(" ")} >> >> /Contents 4 0 R >>`,
    contentStream(
      STANDARD_FONTS.map(
        (font, index) =>
          `BT /F${index + 1} 16 Tf 54 ${730 - 50 * index} Td (${font} Pack my box with five dozen jugs) Tj ET`,
      ).join("\n"),
    ),
    ...STANDARD_FONTS.map(
      (font) => `<< /Type /Font /Subtype /Type1 /BaseFont /${font} >>`,
    ),
  ],
  { header: "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", finalNewline: true },
);

const chromePage = (index: number) => 12 + 2 * index;

function chromeLines(lines: readonly (readonly [number, string])[]): string {
  return lines
    .map(([y, text]) => `BT /F1 11 Tf 72 ${y} Td (${text}) Tj ET`)
    .join("\n");
}

const CHROME_PAGES = [
  [
    "BT /F1 24 Tf 72 740 Td (Introduction) Tj ET",
    chromeLines([
      [700, "Caf\\351 r\\351sum\\351 na\\357ve"],
      [680, "Cafe resume naive"],
      [660, "The fox and the Fox."],
      [640, "foxes are not a fox"],
      [600, "Visit the project page"],
      [580, "Go to page three"],
    ]),
  ].join("\n"),
  [
    "BT /F1 24 Tf 72 740 Td (Methods) Tj ET",
    chromeLines([
      [700, "Sampling starts on the next page."],
      [600, "The highlighted sentence on page two."],
    ]),
  ].join("\n"),
  [
    "BT /F1 24 Tf 72 740 Td (Sampling) Tj ET",
    chromeLines([[700, "Page three holds the sampling notes."]]),
  ].join("\n"),
];

const chrome = buildPdf(
  [
    "<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R /PageLabels << /Nums [0 << /S /r >> 1 << /S /D >>] >> >>",
    `<< /Type /Pages /Kids [${CHROME_PAGES.map((_, index) => `${chromePage(index)} 0 R`).join(" ")}] /Count ${CHROME_PAGES.length} >>`,
    "<< /Type /Outlines /First 4 0 R /Last 6 0 R /Count 3 >>",
    `<< /Title (Introduction) /Parent 3 0 R /Next 5 0 R /Dest [${chromePage(0)} 0 R /XYZ 72 720 0] >>`,
    `<< /Title (Methods) /Parent 3 0 R /Prev 4 0 R /Next 6 0 R /First 7 0 R /Last 7 0 R /Count -1 /Dest [${chromePage(1)} 0 R /XYZ 72 700 null] >>`,
    "<< /Title (Project site) /Parent 3 0 R /Prev 5 0 R /A << /S /URI /URI (https://example.org/zotlit) >> >>",
    `<< /Title (Sampling) /Parent 5 0 R /Dest [${chromePage(2)} 0 R /FitH 500] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Type /Annot /Subtype /Highlight /Rect [70 594 340 614] /QuadPoints [70 614 340 614 70 594 340 594] /Contents (Check this sentence.) /T (Ada Lovelace) /M (D:20240102030405Z) /C [1 1 0] /P ${chromePage(1)} 0 R >>`,
    "<< /Type /Annot /Subtype /Link /Rect [72 596 190 612] /Border [0 0 0] /A << /S /URI /URI (https://example.org/paper) >> >>",
    `<< /Type /Annot /Subtype /Link /Rect [72 576 160 592] /Border [0 0 0] /Dest [${chromePage(2)} 0 R /Fit] >>`,
    ...CHROME_PAGES.map((content, index) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 8 0 R >> >>${index === 0 ? " /Annots [10 0 R 11 0 R]" : index === 1 ? " /Annots [9 0 R]" : ""} /Contents ${chromePage(index) + 1} 0 R >>`,
      contentStream(content),
    ]).flat(),
  ],
  { header: "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", finalNewline: true },
);

const PASSWORD_PAD = Buffer.from(
  "28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A",
  "hex",
);
const PASSWORD_ID = "5A6F744C6974526561646572436872E1";

function padPassword(password: string): Buffer {
  return Buffer.concat([
    Buffer.from(password, "latin1"),
    PASSWORD_PAD,
  ]).subarray(0, 32);
}

function rc4(key: Buffer, data: Buffer): Buffer {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i]! + key[i % key.length]!) % 256;
    [state[i], state[j]] = [state[j]!, state[i]!];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let index = 0; index < data.length; index++) {
    i = (i + 1) % 256;
    j = (j + state[i]!) % 256;
    [state[i], state[j]] = [state[j]!, state[i]!];
    out[index] = data[index]! ^ state[(state[i]! + state[j]!) % 256]!;
  }
  return out;
}

function md5(...parts: readonly Buffer[]): Buffer {
  const hash = createHash("md5");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function passwordEncryption(user: string, owner: string): string {
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const ownerEntry = rc4(
    md5(padPassword(owner)).subarray(0, 5),
    padPassword(user),
  );
  const key = md5(
    padPassword(user),
    ownerEntry,
    permissions,
    Buffer.from(PASSWORD_ID, "hex"),
  ).subarray(0, 5);
  const userEntry = rc4(key, PASSWORD_PAD);
  return `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${ownerEntry.toString("hex").toUpperCase()}> /U <${userEntry.toString("hex").toUpperCase()}> /P -4 >>`;
}

const passwordProtected = buildPdf(
  [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    passwordEncryption("zotlit", "zotlit-owner"),
  ],
  {
    header: "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n",
    trailerEntries: ` /Encrypt 4 0 R /ID [<${PASSWORD_ID}><${PASSWORD_ID}>]`,
    finalNewline: true,
  },
);

const mixedSizes = buildPdf(
  [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] >>",
  ],
  { header: "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", finalNewline: true },
);

const forms = buildPdf(
  [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 4 0 R >> >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Annots [5 0 R] /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (reviewer) /V (Ada Lovelace) /Rect [150 632 378 656] /F 4 /P 3 0 R /DA (/Helv 12 Tf 0 g) /MK << /BC [0 0 0] >> /AP << /N 7 0 R >> >>",
    contentStream(
      chromeLines([
        [700, "The data are at https://example.org/auto for every reader."],
        [640, "Reviewer:"],
      ]),
    ),
    contentStream(
      "/Tx BMC BT /Helv 12 Tf 0 g 2 7 Td (Ada Lovelace) Tj ET EMC",
      "/Type /XObject /Subtype /Form /BBox [0 0 228 24] /Resources << /Font << /Helv 4 0 R >> >> ",
    ),
  ],
  { header: "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", finalNewline: true },
);

const THEME_RED = Buffer.from([200, 40, 40]);

const theme = buildPdf(
  [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [7 0 R] /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 5 0 R >> >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >> /Annots [7 0 R] /Contents 4 0 R >>",
    contentStream(
      [
        "0 0 0.5 rg 20 110 80 70 re f",
        "BT 0 g /F1 72 Tf 120 115 Td (H) Tj ET",
        "q 80 0 0 80 200 110 cm /Im1 Do Q",
      ].join("\n"),
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    binaryStream(
      Buffer.concat([THEME_RED, THEME_RED, THEME_RED, THEME_RED]),
      "/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8",
    ),
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (note) /V (Field text) /Rect [20 20 140 50] /F 4 /P 3 0 R /DA (/Helv 12 Tf 0 g) >>",
  ],
  { header: "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", finalNewline: true },
);

for (const [name, bytes] of [
  ["mock-form.pdf", mockForm],
  ["mock-direct.pdf", mockDirect],
  ["jbig2.pdf", jbig2],
  ["jpx.pdf", jpx],
  ["navigation.pdf", navigation],
  ["standard-fonts.pdf", standardFonts],
  ["chrome.pdf", chrome],
  ["password.pdf", passwordProtected],
  ["mixed-sizes.pdf", mixedSizes],
  ["forms.pdf", forms],
  ["theme.pdf", theme],
] as const) {
  writeFileSync(join(import.meta.dirname, name), bytes);
  console.log(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`);
}

writeFileSync(
  join(import.meta.dirname, "../../vault-pages/pdf-reader-theme.pdf"),
  theme,
);
