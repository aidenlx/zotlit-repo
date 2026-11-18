// The default Annotation section, which every built-in Profile shares. It is
// TypeScript, not a file under defaults/, so Node can load this package from
// source: Node has no `?raw` import.

/** The default Annotation section in Eta. */
export const DEFAULT_ANNOTATION_ETA: string = [
  "<% bq(() => { %>",
  "[!note] <%= zt.pageLabel ? `Page [${zt.pageLabel}](${zt.backlink})` : `[Zotero](${zt.backlink})` %>",
  "",
  '<%= embed(zt.imgLink) %><%= zt.text %><%= zt.citation ? ` ${zt.citation}` : "" %>',
  "<% if (zt.comment) { %>",
  "",
  "<%= zt.comment %>",
  "<% } %>",
  "<% }) %>",
  "",
].join("\n");

/** The default Annotation section in Liquid. */
export const DEFAULT_ANNOTATION_LIQUID: string = [
  "{% bq %}",
  '[!note] {% if zt.pageLabel and zt.pageLabel != "" %}Page [{{ zt.pageLabel }}]({{ zt.backlink }}){% else %}[Zotero]({{ zt.backlink }}){% endif %}',
  "",
  "{{ zt.imgLink | embed }}{{ zt.text }}{% if zt.citation %} {{ zt.citation }}{% endif %}",
  "{% if zt.comment %}",
  "",
  "{{ zt.comment }}",
  "{% endif %}",
  "{% endbq %}",
  "",
].join("\n");
