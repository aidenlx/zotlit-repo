import { sectionOf } from "./model.ts";
import type {
  Doc,
  ItemTypeRow,
  PageModel,
  RowModel,
  TableModel,
} from "./model.ts";

export function renderContractTableMarkdown(
  model: Pick<PageModel, "sections">,
  section: string,
): string {
  const page = sectionOf(model, section);
  if (page.itemTypes.length > 0) {
    return renderItemTypeTable(page.itemTypes);
  }
  return page.tables.map(renderTable).join("\n\n");
}

function renderItemTypeTable(rows: readonly ItemTypeRow[]): string {
  const lines = [
    "| Item type | Fields |",
    "| --- | --- |",
    ...rows.map(
      ({ itemType, fields }) =>
        `| \`${itemType}\` | ${fields.map((field) => `\`${field}\``).join(", ")} |`,
    ),
  ];
  return lines.join("\n");
}

function renderTable(table: TableModel): string {
  const blocks = [
    table.caption && `**${table.caption}**`,
    ...renderDocMarkdown(table.description),
    [
      "| Property | Type | Description |",
      "| --- | --- | --- |",
      ...table.rows.map((row) => renderRow(table, row)),
    ].join("\n"),
  ];
  return blocks.filter((block) => block !== undefined).join("\n\n");
}

function renderRow(table: TableModel, row: RowModel): string {
  const property = cell(
    `\`${(table.prefix ?? "") + row.name}${row.optional ? "?" : ""}\``,
  );
  const type = cell(
    row.typeHref
      ? `[\`${row.fullType}\`](${row.typeHref})`
      : `\`${row.fullType}\``,
  );
  const description = cell(
    [renderDocMarkdown(row.description).join(" "), ...detailNotes(row)]
      .filter((part) => part.length > 0)
      .join(" "),
  );
  return `| ${property} | ${type} | ${description} |`;
}

function detailNotes(row: RowModel): string[] {
  const notes: string[] = [];
  if (row.helper) {
    notes.push(
      `Signature: \`${row.helper.signature}\`.`,
      `Liquid: \`${row.helper.liquid}\`.`,
      `Eta: \`${row.helper.eta}\`.`,
    );
    if (row.helper.filter)
      notes.push(`Liquid filter: \`${row.helper.filter}\`.`);
  }
  if (row.examples.length > 0) {
    const label = row.examples.length > 1 ? "Examples" : "Example";
    const codes = row.examples.map((example) => `\`${example.code}\``);
    notes.push(`${label}: ${codes.join(", ")}.`);
  }
  return notes;
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll(/\s+/g, " ").trim();
}

function renderCodeSpan(value: string): string {
  let fenceLength = 1;
  for (const run of value.match(/`+/g) ?? []) {
    fenceLength = Math.max(fenceLength, run.length + 1);
  }
  const fence = "`".repeat(fenceLength);
  const pad =
    value.startsWith("`") ||
    value.endsWith("`") ||
    (value.startsWith(" ") && value.endsWith(" ") && /[^ ]/.test(value));
  return pad ? `${fence} ${value} ${fence}` : `${fence}${value}${fence}`;
}

export function renderDocMarkdown(
  doc: Doc,
  onText?: (text: string) => string,
): string[] {
  return doc.map((paragraph) =>
    paragraph
      .map((node) => {
        switch (node.kind) {
          case "text":
            return onText ? onText(node.value) : node.value;
          case "code":
            return renderCodeSpan(node.value);
          case "link":
            return `[${node.code ? `\`${node.text}\`` : node.text}](${node.href})`;
        }
      })
      .join(""),
  );
}
