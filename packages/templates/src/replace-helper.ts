import { EtaError } from "eta/core";

export function replaceHelper(
  source: string,
  find: string,
  replace: string,
): string {
  if (!source.includes(find)) {
    throw new EtaError(
      "Template helper rewrite failed — expected eta-generated source not " +
        "found. Re-verify the replace pattern against the installed eta " +
        `version.\nExpected substring:\n  ${find}`,
    );
  }
  return source.replace(find, replace);
}
