const NUMBER =
  "(?:\\d+|(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))";

const PAGE_NUMBER = new RegExp(`^${NUMBER}(?:\\s*[-–]\\s*${NUMBER})?$`, "i");

export function isPageNumber(label: string): boolean {
  return PAGE_NUMBER.test(label.trim());
}
