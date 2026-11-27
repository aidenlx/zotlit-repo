export interface DateFieldSchema {
  readonly itemTypes: readonly {
    readonly fields: readonly {
      readonly field: string;
      readonly baseField?: string;
    }[];
  }[];
  readonly meta: {
    readonly fields: Readonly<Record<string, { readonly type: string }>>;
  };
}

export function dateFieldsOf(schema: DateFieldSchema): string[] {
  const typeOf = (field: string) => schema.meta.fields[field]?.type;
  const dateFields = new Set<string>();
  const consider = (field: string, baseField: string | undefined) => {
    const type =
      typeOf(field) ??
      (baseField === undefined ? undefined : typeOf(baseField));
    if (type === "date") dateFields.add(field);
  };
  for (const field of Object.keys(schema.meta.fields)) {
    consider(field, undefined);
  }
  for (const { fields } of schema.itemTypes) {
    for (const { field, baseField } of fields) consider(field, baseField);
  }
  return [...dateFields];
}
