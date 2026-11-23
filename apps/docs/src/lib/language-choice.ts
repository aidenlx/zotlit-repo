export const LANGUAGE_CHOICE_KEY = "zotlit:language";

export const CHINESE_READER_ATTR = "data-chinese-reader";

export const chineseReaderScript = `try{var c;try{c=localStorage.getItem(${JSON.stringify(LANGUAGE_CHOICE_KEY)})}catch(e){}var l=(navigator.languages&&navigator.languages[0])||navigator.language||"";if(c!=="en"&&/^zh(-|$)/i.test(l))document.documentElement.setAttribute(${JSON.stringify(CHINESE_READER_ATTR)},"")}catch(e){}`;

export function rememberLanguageChoice(locale: string) {
  try {
    localStorage.setItem(LANGUAGE_CHOICE_KEY, locale);
  } catch {
    // Storage can be blocked (private mode, site data off); the suggestion then returns next visit.
  }
  if (locale === "en")
    document.documentElement.removeAttribute(CHINESE_READER_ATTR);
}
