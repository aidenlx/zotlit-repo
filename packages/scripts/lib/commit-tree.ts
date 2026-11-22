const LINT_INPUT = /\.(?:[cm]?[jt]sx?|json)$/;

export function looseFiles(status: string): string[] {
  const fields = status.split("\0");
  const loose: string[] = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!;
    if (field.length < 4) continue;
    const staged = field[0]!;
    const unstaged = field[1]!;
    const path = field.slice(3);
    if ("RC".includes(staged) || "RC".includes(unstaged)) index++;
    if ((staged === " " || staged === "?") && unstaged !== " ") {
      if (LINT_INPUT.test(path)) loose.push(path);
    }
  }
  return loose;
}

export function looseFilesMessage(loose: readonly string[]): string {
  return [
    "Lint reads the working tree, and these files hold changes outside this commit:",
    ...loose.map((path) => `  ${path}`),
    "Move them out of the tree (a WIP commit, or a tagged stash) to check this commit alone,",
    "or run the commit with LEFTHOOK_EXCLUDE=tree to check it together with them.",
  ].join("\n");
}
