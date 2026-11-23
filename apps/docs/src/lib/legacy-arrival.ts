export interface LegacyArrival {
  key: string;
  isZh: boolean;
  v1Src: string;
}

export function legacyArrival(
  { pathname, searchStr }: { pathname: string; searchStr: string },
  dismissed: string | null,
): LegacyArrival | null {
  const params = new URLSearchParams(searchStr);
  const src = params.get("src");
  const v1Src =
    params.get("from") === "v1" && src?.startsWith("/") && !src.startsWith("//")
      ? src
      : null;
  const key = pathname + searchStr;

  return v1Src && key !== dismissed
    ? { key, isZh: params.get("lang") === "zh-CN", v1Src }
    : null;
}
