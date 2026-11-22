export async function usableExcerptWebpPixels(
  bytes: Uint8Array,
): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(
      new Blob([bytes as BlobPart], { type: "image/webp" }),
    );
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}
