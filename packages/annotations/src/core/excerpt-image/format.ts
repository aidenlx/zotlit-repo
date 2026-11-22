import { isWebpContainer, usableExcerptWebp } from "./webp.ts";

export interface ExcerptImageFormat {
  format: "png" | "webp";
  mimeType: "image/png" | "image/webp";
  extension: "png" | "webp";
}

export interface ExcerptImage {
  bytes: Uint8Array;
  format: ExcerptImageFormat;
}

export const PNG_FORMAT: ExcerptImageFormat = {
  format: "png",
  mimeType: "image/png",
  extension: "png",
};
export const WEBP_FORMAT: ExcerptImageFormat = {
  format: "webp",
  mimeType: "image/webp",
  extension: "webp",
};
const KNOWN_FORMATS: Record<string, ExcerptImageFormat> = {
  png: PNG_FORMAT,
  webp: WEBP_FORMAT,
};

export const EXCERPT_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.values(KNOWN_FORMATS).map((known) => known.extension),
);
const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

function isPngSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= PNG_SIGNATURE.byteLength &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}

export function detectExcerptImageFormat(
  bytes: Uint8Array,
): ExcerptImageFormat | undefined {
  if (isPngSignature(bytes)) return PNG_FORMAT;
  return isWebpContainer(bytes) ? WEBP_FORMAT : undefined;
}

const PAYLOAD_CHECKS: Record<string, (bytes: Uint8Array) => boolean> = {
  png: isPngSignature,
  webp: usableExcerptWebp,
};

export function isExcerptPayload(
  format: ExcerptImageFormat,
  bytes: Uint8Array,
): boolean {
  return PAYLOAD_CHECKS[format.format]?.(bytes) ?? false;
}

export function isExcerptImage(image: ExcerptImage): boolean {
  const known = KNOWN_FORMATS[image.format.format];
  if (
    !known ||
    known.mimeType !== image.format.mimeType ||
    known.extension !== image.format.extension
  )
    return false;
  return isExcerptPayload(known, image.bytes);
}
