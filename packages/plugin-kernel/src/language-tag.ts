const LANGUAGE_TAG =
  /^(?:(?:en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)|x(?:-[A-Za-z0-9]{1,8})+|(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}|[A-Za-z]{4,8})(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?(?:-(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*(?:-[0-9A-WY-Za-wy-z](?:-[A-Za-z0-9]{2,8})+)*(?:-x(?:-[A-Za-z0-9]{1,8})+)?)$/i;

export function isLanguageTag(tag: string): boolean {
  return LANGUAGE_TAG.test(tag) && noRepeatedSubtags(tag);
}

const VARIANT = /^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/;

function noRepeatedSubtags(tag: string): boolean {
  const subtags = tag.toLowerCase().split("-");
  if (subtags[0] === "x") return true;
  const privateUse = subtags.indexOf("x", 1);
  const named = privateUse === -1 ? subtags : subtags.slice(0, privateUse);
  const extensions = named.findIndex(
    (subtag, index) => index > 0 && subtag.length === 1,
  );
  const end = extensions === -1 ? named.length : extensions;
  return (
    allDistinct(named.slice(1, end).filter((subtag) => VARIANT.test(subtag))) &&
    allDistinct(named.slice(end).filter((subtag) => subtag.length === 1))
  );
}

function allDistinct(subtags: readonly string[]): boolean {
  return new Set(subtags).size === subtags.length;
}
