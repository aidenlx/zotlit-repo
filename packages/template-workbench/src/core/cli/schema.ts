import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";
import { CONTRACT_ROOTS } from "@zotlit/db";
import type { ContractRoot } from "@zotlit/db";
import { resourceReleaseUrl } from "@zotlit/plugin-kernel/constants.ts";

export const CONTRACT_ROOT_NAMES: readonly ContractRoot[] = CONTRACT_ROOTS;

export interface SchemaAsset {
  url: string;
  fileName: string;
}

export function schemaAssets(
  pluginVersion: string,
): Record<ContractRoot, SchemaAsset> {
  return Object.fromEntries(
    CONTRACT_ROOTS.map((root) => [
      root,
      {
        url: `${resourceReleaseUrl(RELEASE_REPOSITORY, pluginVersion)}/${root}.schema.json`,
        fileName: `zotlit-${root}-${pluginVersion}.schema.json`,
      },
    ]),
  ) as Record<ContractRoot, SchemaAsset>;
}
