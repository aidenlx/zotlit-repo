import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { useWorkbenchModel } from "./editor.tsx";

const NONE: readonly string[] = [];

export function useCustomFieldNames(revision: string): readonly string[] {
  const result = useAtomValue(useWorkbenchModel().customFields(revision));
  return AsyncResult.isSuccess(result) ? result.value : NONE;
}
