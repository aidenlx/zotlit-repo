export interface PageTheme {
  readonly background: string | null;
  readonly invert: boolean;
}

export const plainPage: PageTheme = { background: null, invert: false };

const PAGE_BACKGROUND = "--zpr-page-background";
const DARK_BELOW = 128;

export function lightness([r = 0, g = 0, b = 0]: Iterable<number>): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function lightnessOf(root: HTMLElement, color: string): number {
  const canvas = root.ownerDocument.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return lightness(context.getImageData(0, 0, 1, 1).data);
}

export function readPageTheme(root: HTMLElement, themed: boolean): PageTheme {
  if (!themed) return plainPage;
  const window = root.ownerDocument.defaultView!;
  const background = window
    .getComputedStyle(root)
    .getPropertyValue(PAGE_BACKGROUND)
    .trim();
  if (!background || !window.CSS.supports("color", background)) {
    return plainPage;
  }
  return {
    background,
    invert: lightnessOf(root, background) < DARK_BELOW,
  };
}

export function samePageTheme(a: PageTheme, b: PageTheme): boolean {
  return a.background === b.background && a.invert === b.invert;
}
