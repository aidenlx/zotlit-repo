import { extendTailwindMerge } from "cn/config";
import { createTV } from "tailwind-variants";

const PREFIX = "zt";

export const twMerge = extendTailwindMerge({ prefix: PREFIX });

export const tv = createTV({
  twMerge: true,
  twMergeConfig: { prefix: PREFIX },
});
