const HEADINGS: Readonly<Record<string, string>> = {
  ar: "المراجع",
  ca: "Referències",
  cs: "Literatura",
  da: "Litteratur",
  de: "Literatur",
  el: "Βιβλιογραφία",
  en: "References",
  es: "Referencias",
  fa: "منابع",
  fi: "Lähteet",
  fr: "Références",
  he: "מקורות",
  hu: "Irodalom",
  id: "Daftar Pustaka",
  it: "Bibliografia",
  ja: "参考文献",
  ko: "참고문헌",
  nb: "Litteratur",
  nl: "Literatuur",
  pl: "Bibliografia",
  pt: "Referências",
  ro: "Bibliografie",
  ru: "Список литературы",
  sv: "Referenser",
  th: "บรรณานุกรม",
  tr: "Kaynakça",
  uk: "Список літератури",
  vi: "Tài liệu tham khảo",
  zh: "参考文献",
  "zh-hant": "參考文獻",
  "zh-hk": "參考文獻",
  "zh-mo": "參考文獻",
  "zh-tw": "參考文獻",
};

const DEFAULT_LANGUAGE = "en-US";

export function bibliographyHeadingFilter(
  styleLocale: string | undefined,
): string {
  return `local HEADINGS = pandoc.json.decode(${luaString(JSON.stringify(HEADINGS))})
local FALLBACK = ${luaString(styleLocale || DEFAULT_LANGUAGE)}

local function heading_for(tag)
  local key = tag:lower():gsub("_", "-")
  while key ~= "" do
    if HEADINGS[key] then
      return HEADINGS[key]
    end
    key = key:match("^(.*)%-[^%-]*$") or ""
  end
  return HEADINGS.en
end

local function places_refs(blocks)
  local found = false
  blocks:walk({
    Div = function(div)
      found = found or div.identifier == "refs"
    end,
  })
  return found
end

function Pandoc(doc)
  local meta = doc.meta
  local last = doc.blocks[#doc.blocks]
  if
    meta["reference-section-title"] ~= nil
    or meta["suppress-bibliography"]
    or (last and last.t == "Header")
    or places_refs(doc.blocks)
  then
    return nil
  end
  local tag = meta.lang and pandoc.utils.stringify(meta.lang) or FALLBACK
  meta["reference-section-title"] = pandoc.MetaString(heading_for(tag))
  doc.meta = meta
  return doc
end
`;
}

function luaString(value: string): string {
  return JSON.stringify(value).replaceAll(/\\u([\da-f]{4})/g, "\\u{$1}");
}
