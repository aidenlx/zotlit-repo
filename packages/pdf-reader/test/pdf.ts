import type { DocumentSource } from "#/core/index.ts";

export function buildPdf(objects: readonly string[]): Uint8Array {
  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export function pagesPdf(
  pages: number,
  annotations: Readonly<Record<number, string>> = {},
): Uint8Array {
  const first = 3;
  const kids = Array.from(
    { length: pages },
    (_, index) => `${first + index * 2} 0 R`,
  );
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`,
  ];
  for (let index = 0; index < pages; index++) {
    const content = `BT /F1 24 Tf 72 720 Td (Page ${index + 1}) Tj ET`;
    const annots = annotations[index] ? ` /Annots [${annotations[index]}]` : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${first + index * 2 + 1} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>${annots} >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }
  return buildPdf(objects);
}

export function bytesSource(
  name: string,
  bytes: Uint8Array,
  onRead?: () => void,
): DocumentSource {
  return {
    key: name,
    name,
    read: async () => {
      onRead?.();
      return bytes.slice();
    },
  };
}
