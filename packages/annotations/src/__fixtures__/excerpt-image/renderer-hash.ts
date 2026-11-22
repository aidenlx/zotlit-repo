export interface SyncHash {
  update(value: string): SyncHash;
  digest(encoding: "hex"): string;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64 = (1n << 64n) - 1n;

export function createHash(algorithm: string): SyncHash {
  if (algorithm !== "sha256")
    throw new Error(`Unsupported hash algorithm: ${String(algorithm)}`);
  let hash = FNV_OFFSET;
  const hasher: SyncHash = {
    update(value) {
      for (const byte of new TextEncoder().encode(value))
        hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & UINT64;
      return hasher;
    },
    digest(encoding) {
      if (encoding !== "hex")
        throw new Error(`Unsupported digest encoding: ${String(encoding)}`);
      return hash.toString(16).padStart(16, "0");
    },
  };
  return hasher;
}

export function randomUUID(): string {
  return crypto.randomUUID();
}
