const RIFF_CHUNK = 0x52494646;
const WEBP_BRAND = 0x57454250;
const EXTENDED_CHUNK = 0x56503858;
const LOSSLESS_CHUNK = 0x5650384c;
const REJECTED_CHUNKS: ReadonlySet<number> = new Set([
  0x56503820, 0x414c5048, 0x414e494d, 0x414e4d46,
]);
const ANIMATION_FLAG = 0x02;
const RESERVED_FLAGS = 0xc1;
const LOSSLESS_SIGNATURE = 0x2f;
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

const MAX_ENCODED_BYTES = 32 * 1024 * 1024;
const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const MAX_DIMENSION = 16_383;

export interface ExcerptImageDimensions {
  width: number;
  height: number;
}

function withinDeclaredBounds({
  width,
  height,
}: ExcerptImageDimensions): boolean {
  return (
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION &&
    width * height * 4 <= MAX_DECODED_BYTES
  );
}

function fourcc(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

export function isWebpContainer(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > HEADER_BYTES &&
    fourcc(bytes, 0) === RIFF_CHUNK &&
    fourcc(bytes, 8) === WEBP_BRAND
  );
}

function losslessDimensions(
  bytes: Uint8Array,
  payload: number,
  size: number,
): ExcerptImageDimensions | undefined {
  if (size < 5 || bytes[payload] !== LOSSLESS_SIGNATURE) return undefined;
  const bits = new DataView(
    bytes.buffer,
    bytes.byteOffset + payload + 1,
    4,
  ).getUint32(0, true);
  if (bits >>> 29) return undefined;
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

function extendedDimensions(
  bytes: Uint8Array,
  payload: number,
  size: number,
): ExcerptImageDimensions | undefined {
  if (size < 10) return undefined;
  const flags = bytes[payload]!;
  if (flags & (ANIMATION_FLAG | RESERVED_FLAGS)) return undefined;
  return {
    width:
      (bytes[payload + 4]! |
        (bytes[payload + 5]! << 8) |
        (bytes[payload + 6]! << 16)) +
      1,
    height:
      (bytes[payload + 7]! |
        (bytes[payload + 8]! << 8) |
        (bytes[payload + 9]! << 16)) +
      1,
  };
}

export function usableExcerptWebp(
  bytes: Uint8Array,
  expected?: ExcerptImageDimensions,
): boolean {
  try {
    if (!isWebpContainer(bytes) || bytes.byteLength > MAX_ENCODED_BYTES)
      return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = view.getUint32(4, true) + 8;
    if (end !== bytes.byteLength) return false;
    let lossless: ExcerptImageDimensions | undefined;
    let extended: ExcerptImageDimensions | undefined;
    let offset = HEADER_BYTES;
    while (offset < end) {
      if (end - offset < CHUNK_HEADER_BYTES) return false;
      const chunk = fourcc(bytes, offset);
      if (REJECTED_CHUNKS.has(chunk)) return false;
      const size = view.getUint32(offset + 4, true);
      const payload = offset + CHUNK_HEADER_BYTES;
      if (size > end - payload) return false;
      if (chunk === EXTENDED_CHUNK) {
        extended = extendedDimensions(bytes, payload, size);
        if (!extended || !withinDeclaredBounds(extended)) return false;
      } else if (chunk === LOSSLESS_CHUNK) {
        if (lossless) return false;
        lossless = losslessDimensions(bytes, payload, size);
        if (!lossless || !withinDeclaredBounds(lossless)) return false;
      }
      offset = payload + size + (size & 1);
    }
    if (offset !== end || !lossless) return false;
    if (
      extended &&
      (extended.width !== lossless.width || extended.height !== lossless.height)
    )
      return false;
    return (
      !expected ||
      (expected.width === lossless.width && expected.height === lossless.height)
    );
  } catch {
    return false;
  }
}
