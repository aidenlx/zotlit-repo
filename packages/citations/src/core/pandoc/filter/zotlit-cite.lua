PANDOC_VERSION:must_be_at_least(
  "3.1.1",
  "zotlit-cite needs Pandoc 3.1.1 or newer, which is where pandoc.json arrived"
)

local errors = {}

--@variant sandbox
local selected_literals
local literal_marker
--@end

local function add_error(code, message, context)
  errors[#errors + 1] = { code = code, message = message, context = context }
end

local function report_errors()
  local input = PANDOC_STATE.input_files[1] or "(stdin)"
  for _, err in ipairs(errors) do
    io.stderr:write(string.format("zotlit-cite: [%s] %s\n", err.code, err.message))
    if err.context then
      io.stderr:write(string.format("  in: %s\n", err.context))
    end
    io.stderr:write(string.format("  at: %s\n", input))
  end
  error(string.format("zotlit-cite: stopped on %d error(s)", #errors), 0)
end

local function decode_payload(response, code, source)
  local ok, payload = pcall(pandoc.json.decode, response, false)
  if not ok or type(payload) ~= "table" then
    add_error(
      code,
      string.format("The %s is not valid JSON: %s", source, tostring(response))
    )
    report_errors()
  end
  return payload
end

--@variant cli
local input_absolute
local function input_path()
  if input_absolute then
    return input_absolute
  end
  local input = PANDOC_STATE.input_files[1]
  if not input then
    add_error(
      "file-not-found",
      "The CLI filter variant needs one Markdown input file; Pandoc was given none."
    )
    report_errors()
  end
  input_absolute = input
  if not pandoc.path.is_absolute(input) then
    input_absolute = pandoc.path.normalize(
      pandoc.path.join({ pandoc.system.get_working_directory(), input })
    )
  end
  return input_absolute
end

local function call_obsidian(code, arguments)
  local response
  local ok, err = pcall(function()
    pandoc.system.with_working_directory(pandoc.path.directory(input_path()), function()
      response = pandoc.pipe("obsidian", arguments, "")
    end)
  end)
  if not ok then
    add_error(
      code,
      string.format(
        "`obsidian %s` failed: %s. Obsidian must be running with the input file's vault open and its command line interface enabled.",
        table.concat(arguments, " "),
        tostring(err)
      )
    )
    report_errors()
  end
  return response
end

local function read_resolve_payload()
  return call_obsidian(
    "resolve-call-failed",
    { "zotlit:resolve", "file=" .. input_path() }
  )
end

local function csl_payload(arguments, context)
  local payload = decode_payload(
    call_obsidian("csl-call-failed", arguments),
    "csl-response-invalid",
    "zotlit:csl response"
  )
  if payload.errors and #payload.errors > 0 then
    for _, err in ipairs(payload.errors) do
      add_error(
        err.code or "csl-failed",
        err.message or "The zotlit:csl response reported an error with no message.",
        context
      )
    end
    report_errors()
  end
  return payload
end

local function payload_path(payload, context)
  if type(payload.path) ~= "string" then
    add_error(
      "csl-response-invalid",
      "The zotlit:csl response carries no style path.",
      context
    )
    report_errors()
  end
  return payload.path
end

local function announce(style, origin)
  io.stderr:write(string.format("ZotLit: citations use %s (%s).\n", style, origin))
end

local function origin_of(source)
  local kind = type(source) == "table" and source.kind or nil
  if kind == "note" then
    return "from this note"
  elseif kind == "profile" then
    return string.format("from the %s profile", source.label or "default")
  end
  return "from your vault settings"
end

local function resolve_style(meta)
  local requested = meta["zotlit-csl"]
  if requested ~= nil then
    local standard_field = meta.csl ~= nil and "csl" or "citation-style"
    if meta[standard_field] ~= nil then
      add_error(
        "csl-ambiguous",
        string.format(
          'The document declares its Citation and References Style twice: "%s" names a style file Pandoc opens, "zotlit-csl" names the Zotero-installed style ID ZotLit resolves. Keep one of them.',
          standard_field
        )
      )
      report_errors()
    end
    local style = pandoc.utils.stringify(requested)
    local context = string.format("zotlit-csl: %s", style)
    local payload = csl_payload({ "zotlit:csl", "style=" .. style }, context)
    meta.csl = pandoc.MetaString(payload_path(payload, context))
    meta["zotlit-csl"] = nil
    announce(payload.title or style, "from this note")
    return meta
  end

  local standard = meta.csl or meta["citation-style"]
  if standard ~= nil then
    announce(
      string.format("the style file %s", pandoc.utils.stringify(standard)),
      "from the csl field or the --csl option"
    )
    return meta
  end

  local context = "the style ZotLit selects for this note"
  local payload = csl_payload({ "zotlit:csl", "file=" .. input_path() }, context)
  if type(payload.styleId) ~= "string" then
    announce("the Pandoc default style, Chicago author-date", origin_of(payload.source))
    return meta
  end
  meta.csl = pandoc.MetaString(payload_path(payload, context))
  announce(payload.title or payload.styleId, origin_of(payload.source))
  return meta
end
--@end

--@variant sandbox
local RESOLVE_MAP_FILE = "zotlit-resolve-map.json"

local function read_resolve_payload()
  local handle = io.open(RESOLVE_MAP_FILE, "r")
  if not handle then
    add_error(
      "resolve-map-missing",
      string.format(
        'The sandbox filter variant needs a pre-written resolve map at "%s", relative to the Pandoc working directory.',
        RESOLVE_MAP_FILE
      )
    )
    report_errors()
  end
  local response = handle:read("a")
  handle:close()
  return response
end

local function resolve_style(meta)
  return meta
end
--@end

local function load_citations()
  local payload = decode_payload(
    read_resolve_payload(),
    "resolve-map-invalid",
    "resolution map"
  )
  if payload.errors and #payload.errors > 0 then
    for _, err in ipairs(payload.errors) do
      add_error(
        err.code or "resolve-failed",
        err.message or "The resolution map reported an error with no message.",
        err.linkpath and string.format("[[%s]]", err.linkpath)
      )
    end
    report_errors()
  end
--@variant sandbox
  selected_literals = payload.selectedLiterals
  literal_marker = payload.literalMarker
--@end
  return payload.citations or {}
end

local function decode_linkpath(target)
  return (target:gsub("%%(%x%x)", function(hex)
    return string.char(tonumber(hex, 16))
  end))
end

local function decode_value(raw)
  local out, index = {}, 1
  while index <= #raw do
    local char = raw:sub(index, index)
    if char == "%" then
      local hex = raw:sub(index + 1, index + 2)
      if not hex:match("^%x%x$") then
        return nil, "malformed percent encoding"
      end
      out[#out + 1] = string.char(tonumber(hex, 16))
      index = index + 3
    else
      out[#out + 1] = char
      index = index + 1
    end
  end
  local value = table.concat(out)
  if not utf8.len(value) then
    return nil, "invalid UTF-8 after decoding"
  end
  for _, code_point in utf8.codes(value) do
    if code_point >= 0xD800 and code_point <= 0xDFFF then
      return nil, "invalid UTF-8 after decoding"
    end
  end
  return value
end

local EDGE_WHITESPACE = {
  [0x0009] = true, [0x000A] = true, [0x000B] = true, [0x000C] = true,
  [0x000D] = true, [0x0020] = true, [0x0085] = true, [0x00A0] = true,
  [0x1680] = true, [0x2000] = true, [0x2001] = true, [0x2002] = true,
  [0x2003] = true, [0x2004] = true, [0x2005] = true, [0x2006] = true,
  [0x2007] = true, [0x2008] = true, [0x2009] = true, [0x200A] = true,
  [0x2028] = true, [0x2029] = true, [0x202F] = true, [0x205F] = true,
  [0x3000] = true,
}
local LINE_BREAK = {
  [0x000A] = true, [0x000D] = true, [0x0085] = true, [0x2028] = true, [0x2029] = true,
}
local function is_control(code_point)
  return code_point <= 0x1F or (code_point >= 0x7F and code_point <= 0x9F)
end

local function text_defect(value)
  if value == "" then
    return "an empty value"
  end
  local first = utf8.codepoint(value)
  local last = first
  local has_line_break, has_control = false, false
  for _, code_point in utf8.codes(value) do
    last = code_point
    has_line_break = has_line_break or LINE_BREAK[code_point]
    has_control = has_control or is_control(code_point)
  end
  if EDGE_WHITESPACE[first] or EDGE_WHITESPACE[last] then
    return "leading or trailing whitespace"
  end
  if has_line_break then
    return "a line break"
  end
  if has_control then
    return "a control character"
  end
  return nil
end

local function split(text, separator)
  local parts, start = {}, 1
  while true do
    local at = text:find(separator, start, true)
    if not at then
      parts[#parts + 1] = text:sub(start)
      return parts
    end
    parts[#parts + 1] = text:sub(start, at - 1)
    start = at + #separator
  end
end

local PARAMETERS = { mode = true, prefix = true, label = true, locator = true, suffix = true }

local CITATION_MODES = {
  normal = "NormalCitation",
  ["author-in-text"] = "AuthorInText",
  ["suppress-author"] = "SuppressAuthor",
}

local LOCATOR_TERMS = {
  book = "book",
  chapter = "chapter",
  column = "column",
  figure = "figure",
  folio = "folio",
  issue = "issue",
  line = "line",
  note = "note",
  opus = "opus",
  page = "page",
  paragraph = "paragraph",
  part = "part",
  section = "section",
  ["sub-verbo"] = "sub verbo",
  verse = "verse",
  volume = "volume",
}

local function parse_fragment(fragment)
  if fragment == "" then
    return nil, "the Citation Fragment is empty"
  end

  local details = { mode = "normal" }
  local seen = {}
  for _, pair in ipairs(split(fragment, "&")) do
    local name, raw = pair:match("^([^=]*)=(.*)$")
    if not name then
      return nil, string.format('"%s" is missing its "="', pair)
    end
    if name == "" then
      return nil, string.format('"%s" has an empty parameter name', pair)
    end
    if not PARAMETERS[name] then
      return nil, string.format('"%s" is not a Citation Fragment parameter', name)
    end
    if seen[name] then
      return nil, string.format('"%s" appears more than once', name)
    end
    seen[name] = true

    local value, reason = decode_value(raw)
    if not value then
      return nil, string.format('"%s" has %s', name, reason)
    end
    local defect = text_defect(value)
    if defect then
      return nil, string.format('"%s" has %s', name, defect)
    end
    details[name] = value
  end

  if not CITATION_MODES[details.mode] then
    return nil, string.format('"mode" does not support "%s"', details.mode)
  end
  if details.label and not LOCATOR_TERMS[details.label] then
    return nil, string.format('"label" does not support "%s"', details.label)
  end
  if details.label and not details.locator then
    return nil, '"label" needs a "locator"'
  end
  if details.mode == "author-in-text" and details.prefix then
    return nil, '"prefix" does not combine with mode=author-in-text; keep the introduction outside the link'
  end
  return details
end

local function to_inlines(text)
  local inlines = pandoc.Inlines({})
  for word in text:gmatch("[^ \t\n\v\f\r]+") do
    if #inlines > 0 then
      inlines:insert(pandoc.Space())
    end
    inlines:insert(pandoc.Str(word))
  end
  return inlines
end

local function build_suffix(details)
  local suffix = pandoc.Inlines({})
  if details.locator then
    suffix:extend(to_inlines(LOCATOR_TERMS[details.label or "page"]))
    suffix:insert(pandoc.Space())
    suffix:extend(to_inlines(details.locator))
  end
  if details.suffix then
    if #suffix > 0 then
      suffix:insert(pandoc.Str(","))
      suffix:insert(pandoc.Space())
    end
    suffix:extend(to_inlines(details.suffix))
  end
  return suffix
end

local function build_cite(items)
  local entries, keys = {}, {}
  for position, item in ipairs(items) do
    if position > 1 and item.details.mode == "author-in-text" then
      add_error(
        "author-in-text-position",
        "An author-in-text Citation can occupy only the first position in a Citation Run.",
        item.context
      )
    end
    entries[position] = pandoc.Citation(
      item.key,
      CITATION_MODES[item.details.mode],
      to_inlines(item.details.prefix or ""),
      build_suffix(item.details),
      0
    )
    keys[position] = "@" .. item.key
  end
  return pandoc.Cite({ pandoc.Str("[" .. table.concat(keys, "; ") .. "]") }, entries)
end

local citations = {}

local function classify_target(target)
  local hash = target:find("#", 1, true)
  local bare = hash and target:sub(1, hash - 1) or target
  local fragment = hash and target:sub(hash + 1) or nil
  local intent = fragment and fragment:sub(1, 5) == "cite:" and fragment:sub(6) or nil

  local linkpath = decode_linkpath(bare)
  local key = citations[linkpath]
  local context = string.format("[[%s]]", target)

  if not key then
    if intent then
      add_error(
        "unresolved-citation-intent",
        string.format(
          'The "#cite:" fragment declares a Citation, but "%s" does not resolve to a Literature Note.',
          linkpath
        ),
        context
      )
    end
    return nil
  end

  if not intent then
    return { key = key, details = { mode = "normal" }, context = context }
  end

  local details, reason = parse_fragment(intent)
  if not details then
    add_error("citation-fragment-invalid", reason, context)
    return nil
  end
  return { key = key, details = details, context = context, intent = true }
end

local classified = {}
local function classify(link)
  local cached = classified[link.target]
  if cached == nil then
    cached = classify_target(link.target) or false
    classified[link.target] = cached
  end
  return cached or nil
end

local function process_inlines(inlines)
  local result = pandoc.Inlines({})
  local index = 1
  while index <= #inlines do
    local inline = inlines[index]
    local item = inline.t == "Link" and classify(inline) or nil
    if not item then
      result:insert(inline)
      index = index + 1
    else
      local items, last = { item }, index
      local cursor = index + 1
      while true do
        while inlines[cursor] and inlines[cursor].t == "Space" do
          cursor = cursor + 1
        end
        local separator = inlines[cursor]
        if not (separator and separator.t == "Str" and separator.text == ";") then
          break
        end
        cursor = cursor + 1
        while inlines[cursor] and inlines[cursor].t == "Space" do
          cursor = cursor + 1
        end
        local candidate = inlines[cursor]
        local next_item = candidate and candidate.t == "Link" and classify(candidate) or nil
        if not next_item then
          break
        end
        items[#items + 1] = next_item
        last = cursor
        cursor = cursor + 1
      end
      result:insert(build_cite(items))
      index = last + 1
    end
  end
  return result
end

local nested_ids = {}

local function literal_text(cite)
  local keys = {}
  for position, citation in ipairs(cite.citations) do
    local key = citation.id
--@variant sandbox
    key = selected_literals and selected_literals[key] or key
--@end
    local sign = citation.mode == "SuppressAuthor" and "-@" or "@"
    keys[position] = sign .. key
  end
  return table.concat(keys, "; ")
end

local NESTED = {
  Link = function(link)
    local item = classify(link)
    if not item then
      return nil
    end
    if item.intent then
      add_error(
        "nested-citation-intent",
        'The "#cite:" fragment declares a Citation inside another Citation\'s prefix or suffix, where a Citation exports as its text. Move the link outside the brackets, or drop the fragment.',
        item.context
      )
    end
    nested_ids[#nested_ids + 1] = item.key
    return link.content
  end,
  Cite = function(cite)
    for _, citation in ipairs(cite.citations) do
      nested_ids[#nested_ids + 1] = citation.id
    end
    return to_inlines(literal_text(cite))
  end,
}

local function flatten_nested(cite)
  local citations = pandoc.List({})
  for _, citation in ipairs(cite.citations) do
    citation.prefix = citation.prefix:walk(NESTED)
    citation.suffix = citation.suffix:walk(NESTED)
    citations:insert(citation)
  end
  cite.citations = citations
  return cite
end

local function add_nocite(meta)
  if #nested_ids == 0 then
    return meta
  end
  local citations = {}
  for position, id in ipairs(nested_ids) do
    citations[position] = pandoc.Citation(id, "NormalCitation")
  end
  local cite = pandoc.Cite({ pandoc.Str("") }, citations)
  local existing = meta.nocite
  if existing == nil then
    meta.nocite = pandoc.MetaInlines({ cite })
  elseif pandoc.utils.type(existing) == "Inlines" then
    existing:extend({ pandoc.Space(), cite })
    meta.nocite = existing
  else
    meta.nocite = pandoc.MetaList({ existing, pandoc.MetaInlines({ cite }) })
  end
  return meta
end

local CALLOUT_MARKER = "^%[![^%]]+%][+-]?$"

local function trim(inlines)
  while inlines[1] and inlines[1].t == "Space" do
    inlines:remove(1)
  end
  while inlines[#inlines] and inlines[#inlines].t == "Space" do
    inlines:remove(#inlines)
  end
  return inlines
end

local function convert_callout(quote)
  local first = quote.content[1]
  if not (first and (first.t == "Para" or first.t == "Plain")) then
    return nil
  end
  local marker = first.content[1]
  if not (marker and marker.t == "Str" and marker.text:match(CALLOUT_MARKER)) then
    return nil
  end
  local title, body = pandoc.Inlines({}), pandoc.Inlines({})
  local target = title
  for index = 2, #first.content do
    local inline = first.content[index]
    if target == title and (inline.t == "SoftBreak" or inline.t == "LineBreak") then
      target = body
    else
      target:insert(inline)
    end
  end
  local blocks = pandoc.Blocks({})
  if #trim(title) > 0 then
    blocks:insert(pandoc.Para({ pandoc.Strong(title) }))
  end
  if #trim(body) > 0 then
    blocks:insert(pandoc.Para(body))
  end
  for index = 2, #quote.content do
    blocks:insert(quote.content[index])
  end
  return pandoc.BlockQuote(blocks)
end

local function read_markdown(text, extensions)
  return pandoc.read(text, {
    format = "markdown", extensions = extensions or PANDOC_READER_OPTIONS.extensions
  }, PANDOC_READER_OPTIONS)
end

--@variant cli
local function split_properties(source)
  local from = source:match("^%-%-%-\r?\n()")
  if not from then
    return nil, source
  end
  local position = from
  while true do
    local start = source:find("---", position, true)
    if not start then
      return nil, source
    end
    local after = start + 3
    if source:sub(start - 1, start - 1) == "\n" then
      local content = source:match("^\r?\n()", after)
      if content or after > #source then
        return source:sub(from, start - 1), source:sub(content or after)
      end
    end
    position = start + 1
  end
end

local function read_properties(doc)
  local input = io.open(input_path(), "r")
  if not input then
    return doc
  end
  local properties, body = split_properties(input:read("a"))
  input:close()
  if not properties then
    return doc
  end
  local meta = pandoc.Meta({})
  local yaml = properties:gsub("^%s*\n", "")
  if yaml:match("%S") then
    local extensions = pandoc.List({ "yaml_metadata_block" })
    extensions:extend(PANDOC_READER_OPTIONS.extensions)
    meta = read_markdown("---\n" .. yaml .. "\n---\n", extensions).meta
  end
  for key, value in pairs(doc.meta) do
    meta[key] = value
  end
  return pandoc.Pandoc(read_markdown(body).blocks, meta)
end
--@end

function Pandoc(doc)
--@variant cli
  doc = read_properties(doc)
--@end
  doc.meta = resolve_style(doc.meta)
  citations = load_citations()
--@variant sandbox
  if selected_literals then
    local input = assert(io.open("stdin", "r"))
    local unmarked = input:read("a"):gsub(literal_marker .. "%d+", "")
    input:close()
    local identifiers = {}
    local original = read_markdown(unmarked)
    pandoc.Pandoc(original.blocks):walk({ Header = function(header)
      identifiers[#identifiers + 1] = header.identifier
    end })
    local heading = 0
    local body = pandoc.Pandoc(doc.blocks):walk({ Cite = function(cite)
      for _, citation in ipairs(cite.citations) do
        if not selected_literals[citation.id] then
          return cite.content
        end
      end
    end, Header = function(header)
      heading = heading + 1
      header.identifier = identifiers[heading]
      return header
    end })
    doc.blocks = body.blocks
  end
--@end
  doc.blocks = pandoc.Pandoc(doc.blocks):walk({ Cite = flatten_nested }).blocks
  doc.meta = add_nocite(doc.meta)
  local converted = doc:walk({ Inlines = process_inlines, BlockQuote = convert_callout })
  if #errors > 0 then
    report_errors()
  end
  return converted
end
