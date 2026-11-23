export const SOURCE_ID_HEADER = "X-Zotlit-Source-Id";
export const SOURCE_MISMATCH_STATUS = 409;

const DJB2A_SEED = 5381;

export function djb2a(input: string): number {
  let hash = DJB2A_SEED;
  for (let index = 0; index < input.length; index++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return hash >>> 0;
}

export function normalizeFileUri(uri: string): string {
  return uri
    .normalize("NFC")
    .replace(/\/+$/, "")
    .replace(/^(file:\/\/\/)([a-z]):/i, (_, prefix, drive) => {
      return `${prefix}${(drive as string).toUpperCase()}:`;
    });
}

export function sourceIdFromUris(profileUri: string, dataUri: string): string {
  const input = `${normalizeFileUri(profileUri)}\0${normalizeFileUri(dataUri)}`;
  return djb2a(input).toString(16).padStart(8, "0");
}
