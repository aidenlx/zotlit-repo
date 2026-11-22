import type { RenderedProperty } from "#core/render/result.ts";
import { regex } from "arkregex";
import type { IconName } from "obsidian";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import * as m from "@zotlit/plugin-messages/messages.ts";

export type PropertyType =
  | "text"
  | "list"
  | "tags"
  | "aliases"
  | "number"
  | "checkbox"
  | "date"
  | "datetime";

const PROPERTY_ICONS: Record<PropertyType, IconName> = {
  text: "text",
  list: "list",
  tags: "tags",
  aliases: "forward",
  number: "binary",
  checkbox: "check-square",
  date: "calendar",
  datetime: "clock",
};

const DATE = regex("^\\d{4}-[01]\\d-[0-3]\\d$");
const DATETIME = regex("^\\d{4}-[01]\\d-[0-3]\\dT[0-2]\\d:[0-5]\\d");

export function propertyType(property: RenderedProperty): PropertyType {
  if (property.key === "tags") return "tags";
  if (property.key === "aliases") return "aliases";
  const { value } = property;
  if (Array.isArray(value)) return "list";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "string") {
    if (DATE.test(value)) return "date";
    if (DATETIME.test(value)) return "datetime";
  }
  return "text";
}

export function PropertyList({
  properties,
  label,
  variant = "list",
}: {
  properties: readonly RenderedProperty[];
  label?: string;
  variant?: "list" | "note" | "spread";
}) {
  return (
    <dl aria-label={label} data-part={variant} className="metadata-properties">
      {properties.map((property) => {
        const type = propertyType(property);
        return (
          <div
            key={`${property.position}:${property.key}`}
            data-part="row"
            data-state={type}
            className="metadata-property"
          >
            <dt data-part="key" className="metadata-property-key">
              <span
                aria-hidden="true"
                data-part="icon"
                className="metadata-property-icon"
              >
                <Icon name={PROPERTY_ICONS[type]} />
              </span>
              <span data-part="label" className="metadata-property-key-input">
                {property.key}
              </span>
            </dt>
            <dd
              data-part="value"
              data-state={type}
              className="metadata-property-value"
            >
              <PropertyValue property={property} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function PropertyValue({ property }: { property: RenderedProperty }) {
  const { value } = property;
  if (
    property.missing ||
    value == null ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return (
      <span data-part="empty" className="metadata-input-longtext">
        {property.missing
          ? m.workbench_property_unset()
          : m.workbench_property_empty()}
      </span>
    );
  }
  if (Array.isArray(value)) {
    return (
      <div data-part="pills" className="multi-select-container">
        {value.map((item, index) => (
          <div key={index} data-part="pill" className="multi-select-pill">
            <span data-part="pill-text" className="multi-select-pill-content">
              {propertyText(item)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value}
        readOnly
        aria-readonly="true"
        tabIndex={-1}
        onClick={(event) => event.preventDefault()}
        data-part="checkbox"
        className="metadata-input-checkbox"
      />
    );
  }
  return (
    <span data-part="text" className="metadata-input-longtext">
      {propertyText(value)}
    </span>
  );
}

export function propertyText(value: unknown): string {
  if (Array.isArray(value)) return value.map(propertyText).join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
