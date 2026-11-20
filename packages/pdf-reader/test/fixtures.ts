import { inlineBytes } from "#test/data.ts";

const assets = import.meta.glob<string>(
  [
    "../../scripts/lib/fixture/assets/pdf-reader/*.pdf",
    "../../scripts/lib/fixture/assets/excerpt-rendering/{corrupt,encrypted,excerpt-rendering}.pdf",
    "../../scripts/lib/fixture/assets/sandve-2013/sandve-2013.pdf",
    "../../scripts/lib/fixture/assets/sakimas-song/sakimas-song.pdf",
  ],
  { eager: true, query: "?inline", import: "default" },
);

export type FixturePdf =
  | "excerpt-rendering/corrupt.pdf"
  | "excerpt-rendering/encrypted.pdf"
  | "excerpt-rendering/excerpt-rendering.pdf"
  | "pdf-reader/mock-form.pdf"
  | "pdf-reader/mock-direct.pdf"
  | "pdf-reader/jbig2.pdf"
  | "pdf-reader/jpx.pdf"
  | "pdf-reader/navigation.pdf"
  | "pdf-reader/standard-fonts.pdf"
  | "pdf-reader/chrome.pdf"
  | "pdf-reader/password.pdf"
  | "pdf-reader/mixed-sizes.pdf"
  | "pdf-reader/theme.pdf"
  | "sandve-2013/sandve-2013.pdf"
  | "sakimas-song/sakimas-song.pdf";

export function fixturePdf(name: FixturePdf): Uint8Array {
  const file = assets[`../../scripts/lib/fixture/assets/${name}`];
  if (file === undefined) throw new Error(`No Fixture PDF ${name}`);
  return inlineBytes(file);
}
