const cmaps = import.meta.glob<string>(
  "../node_modules/@zotlit/pdfjs/dist/cmaps/*.bcmap",
  { eager: true, query: "?inline", import: "default" },
);
const standardFonts = import.meta.glob<string>(
  "../node_modules/@zotlit/pdfjs/dist/standard_fonts/*.{pfb,ttf}",
  { eager: true, query: "?inline", import: "default" },
);

export function inlineBytes(dataUrl: string): Uint8Array {
  return Uint8Array.from(
    atob(dataUrl.slice(dataUrl.indexOf(",") + 1)),
    (char) => char.charCodeAt(0),
  );
}

export const fetchRequests: string[] = [];

export async function testFetchData(
  kind: "cmap" | "standard-font",
  filename: string,
): Promise<Uint8Array> {
  fetchRequests.push(`${kind}:${filename}`);
  const files = kind === "cmap" ? cmaps : standardFonts;
  const folder = kind === "cmap" ? "cmaps" : "standard_fonts";
  const file =
    files[`../node_modules/@zotlit/pdfjs/dist/${folder}/${filename}`];
  if (file === undefined) throw new Error(`No PDF.js ${kind} file ${filename}`);
  return inlineBytes(file);
}
