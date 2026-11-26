export type RemoteLanguagePack = {
  fileName: string;
};

export type PackSource = {
  baseUrl: string;
  origin: string;
};

export type LocaleKeys<
  BaseLocale extends string,
  Packs extends Readonly<Partial<Record<string, RemoteLanguagePack>>>,
> = BaseLocale | Extract<keyof Packs, string>;

export type LocaleCatalog<
  BaseLocale extends string = string,
  Packs extends Readonly<Partial<Record<string, RemoteLanguagePack>>> =
    Readonly<Partial<Record<string, RemoteLanguagePack>>>,
> = {
  baseLocale: BaseLocale;
  packs: Packs;
};

export type LanguagePackRestartNotice = {
  fileName: string;
};

export type RemotePackInfo = {
  fileName: string;
  origin: string;
};

export type LanguagePackSituation =
  | { kind: "unavailable" }
  | { kind: "offered"; pack: RemotePackInfo }
  | { kind: "installable"; pack: RemotePackInfo }
  | { kind: "downloading"; pack: RemotePackInfo }
  | { kind: "restart-pending"; pack: RemotePackInfo }
  | { kind: "active"; pack: RemotePackInfo };

export function resolveLocale<
  const BaseLocale extends string,
  const Packs extends Readonly<Partial<Record<string, RemoteLanguagePack>>>,
>(
  language: string,
  catalog: LocaleCatalog<BaseLocale, Packs>,
  aliases: Readonly<Record<string, NoInfer<LocaleKeys<BaseLocale, Packs>>>>,
): LocaleKeys<BaseLocale, Packs> {
  if (
    language === catalog.baseLocale ||
    Object.hasOwn(catalog.packs, language)
  ) {
    return language as LocaleKeys<BaseLocale, Packs>;
  }
  return aliases[language] ?? catalog.baseLocale;
}
