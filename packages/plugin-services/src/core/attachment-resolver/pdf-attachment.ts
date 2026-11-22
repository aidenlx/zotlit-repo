const PDF_EXTENSION_RE = /\.pdf$/i;

export function isPdfAttachment(
  contentType: string | null,
  absolutePath: string,
): boolean {
  return contentType !== null
    ? contentType === "application/pdf"
    : PDF_EXTENSION_RE.test(absolutePath);
}
