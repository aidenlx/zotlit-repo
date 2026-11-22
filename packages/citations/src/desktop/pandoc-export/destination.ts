import { isAbsolute, join, relative, sep } from "node:path";

export function exportDestinationLocation(
  destination: string,
  { vaultPath, homePath }: { vaultPath: string; homePath: string },
): { kind: "vault" | "external"; path: string } {
  const inVault = childPath(vaultPath, destination);
  if (inVault !== null) return { kind: "vault", path: inVault };
  const inHome = childPath(homePath, destination);
  return {
    kind: "external",
    path: inHome === null ? destination : join("~", inHome),
  };
}

function childPath(folder: string, destination: string): string | null {
  const path = relative(folder, destination);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)
    ? null
    : path;
}
