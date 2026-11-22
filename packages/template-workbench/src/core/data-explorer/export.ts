import { CONTRACT_VERSION } from "@zotlit/db";
import type { ContractRoot } from "@zotlit/db";
import { serializeTemplateData } from "@zotlit/db/template-data";

export interface TemplateDataExportInput {
  readonly root: object;
  readonly contractRoot: ContractRoot;
  readonly indexedKey: string;
  readonly pluginVersion: string;
  readonly timestamp: string;
}

export interface TemplateDataExport {
  readonly filename: string;
  readonly json: string;
}

export function buildTemplateDataExport(
  input: TemplateDataExportInput,
): TemplateDataExport {
  const zt = serializeTemplateData(input.root, input.contractRoot);
  return {
    filename: `zotlit-template-data-${input.indexedKey}-${input.timestamp}.json`,
    json: JSON.stringify(
      {
        templateContractVersion: CONTRACT_VERSION,
        pluginVersion: input.pluginVersion,
        request: { key: input.indexedKey, root: input.contractRoot },
        zt,
      },
      null,
      2,
    ),
  };
}
