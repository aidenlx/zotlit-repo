const SOURCE_MAP_LINE =
  /^\/\/[@#] sourceMappingURL=data:application\/json(?:;charset[:=][^;]+)?;base64,.*$/gmu;

const INSTALL_TAIL = "\n/* nosourcemap */";

export function applyObsidianInstall(mainJs: string): string {
  return mainJs.replaceAll(SOURCE_MAP_LINE, "") + INSTALL_TAIL;
}
