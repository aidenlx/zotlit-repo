const INKS = { "#1E3A5F": "ink", "#E8622C": "accent" } as const;

type Ink = (typeof INKS)[keyof typeof INKS];

export type BrandPaths = Record<Ink, string[]>;

export function brandPaths(svg: string, group?: number): BrandPaths {
  const root = new DOMParser().parseFromString(
    svg,
    "image/svg+xml",
  ).documentElement;
  const scope =
    group === undefined ? root : root.querySelectorAll(":scope > g")[group];
  if (!scope) throw new Error(`The logo has no top-level group ${group}`);
  const paths: BrandPaths = { ink: [], accent: [] };
  for (const path of scope.querySelectorAll("path")) {
    const fill = path.getAttribute("fill")?.toUpperCase() ?? "";
    const ink = fill in INKS ? INKS[fill as keyof typeof INKS] : undefined;
    if (!ink) throw new Error(`The logo has a fill outside its inks: ${fill}`);
    paths[ink].push(path.getAttribute("d") ?? "");
  }
  return paths;
}
