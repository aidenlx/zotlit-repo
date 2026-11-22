import type { FieldDefinition } from "./fields.ts";
import type { TargetLibrary } from "./request.ts";

const readLibrary = ({ groupID }: Pick<TargetLibrary, "groupID">): string =>
  groupID === null ? "personal" : `group:${groupID}`;

export const libraryField: FieldDefinition<
  Pick<TargetLibrary, "groupID">,
  object
> = {
  shape: { kind: "scalar", type: "string" },
  valueForms: ["personal", "group:<groupID>"],
  needs: () => ({}),
  read: readLibrary,
  filter: { type: "string", read: readLibrary },
};
