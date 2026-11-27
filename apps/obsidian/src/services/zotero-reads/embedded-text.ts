type FromBase64 = (base64: string) => Uint8Array<ArrayBuffer>;

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const fromBase64 = Reflect.get(Uint8Array, "fromBase64") as
    | FromBase64
    | undefined;
  if (typeof fromBase64 === "function") return fromBase64(base64);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function inflateEmbedded(base64: string): Promise<Blob> {
  return new Response(
    new Blob([bytesOf(base64)])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw")),
  ).blob();
}
