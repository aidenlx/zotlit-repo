import type {
  RenderCaller,
  RenderDiagnostic,
  RenderEngineLocation,
  RenderIdentity,
} from "./render-diagnostic.ts";

export const REPORT_UNAVAILABLE = "unavailable";

export interface EngineEvidence {
  readonly message: string;
  readonly name?: string;
  readonly stack?: string;
  readonly causes?: readonly string[];
  readonly context?: string;
  readonly reportedLocation?: string;
}

export interface WorkbenchReportContext {
  readonly document?: string;
  readonly language?: string;
  readonly root?: string;
  readonly selection?: string;
  readonly zotlitVersion?: string;
  readonly hostVersion?: string;
  readonly engineVersion?: string;
}

export interface RenderReport {
  readonly code: string;
  readonly evidence?: EngineEvidence;
  readonly engineLocation?: string;
  readonly caller?: string;
  readonly repairTarget?: string;
  readonly section?: string;
  readonly capturedAt: string;
  readonly trigger: "explicit" | "automatic";
  readonly sequence?: number;
  readonly identity: RenderIdentity;
  readonly context: WorkbenchReportContext;
}

export function errorChain(error: unknown): readonly Error[] {
  const found: Error[] = [];
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();

  while (pending.length > 0) {
    const link = pending.shift();
    if (link === null || typeof link !== "object" || seen.has(link)) continue;
    seen.add(link);
    if (Error.isError(link)) found.push(link);
    const {
      cause,
      originalError,
      errors: batch,
    } = link as Record<string, unknown>;
    pending.push(cause, originalError, ...(Array.isArray(batch) ? batch : []));
  }
  return found;
}

function readString(source: object, key: string): string | undefined {
  const value: unknown = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(source: object, key: string): number | undefined {
  const value: unknown = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function engineContext(error: Error): string | undefined {
  return readString(error, "context");
}

function engineReportedLocation(error: Error): string | undefined {
  const token: unknown = (error as { token?: unknown }).token;
  const where =
    readString(error, "templateName") ??
    readString(error, "filepath") ??
    readString(error, "path") ??
    (token !== null && typeof token === "object"
      ? readString(token, "file")
      : undefined);
  const line =
    readNumber(error, "line") ??
    readNumber(error, "lineNo") ??
    readNumber(error, "lineNumber");
  if (where === undefined)
    return line === undefined ? undefined : `line ${line}`;
  return line === undefined ? where : `${where}:${line}`;
}

export function engineEvidence(error: unknown): EngineEvidence {
  const chain = errorChain(error);
  const head = chain[0];
  if (head === undefined) return { message: String(error) };
  const causes = chain
    .slice(1)
    .map(({ message }) => message)
    .filter((message) => message.length > 0);
  const context = chain.map(engineContext).find((found) => found !== undefined);
  const reportedLocation = chain
    .map(engineReportedLocation)
    .find((found) => found !== undefined);
  return {
    message: head.message,
    ...(head.name ? { name: head.name } : {}),
    ...(head.stack === undefined ? {} : { stack: head.stack }),
    ...(causes.length > 0 ? { causes } : {}),
    ...(context === undefined ? {} : { context }),
    ...(reportedLocation === undefined ? {} : { reportedLocation }),
  };
}

function reportSection(diagnostic: RenderDiagnostic): string | undefined {
  return diagnostic.position === undefined
    ? diagnostic.part
    : `property ${diagnostic.position}`;
}

function reportEngineLocation(
  engine: RenderEngineLocation | undefined,
): string | undefined {
  if (engine === undefined) return undefined;
  const { template, line, column } = engine;
  if (line === undefined) return template;
  return column === undefined
    ? `${template}:${line}`
    : `${template}:${line}:${column}`;
}

function reportCaller(caller: RenderCaller | undefined): string | undefined {
  return caller === undefined
    ? undefined
    : (caller.document ?? caller.template);
}

function reportRepairTarget(
  callSite: RenderDiagnostic["callSite"],
): string | undefined {
  return callSite === undefined
    ? undefined
    : `offset ${callSite.from}-${callSite.to}`;
}

function reportIdentity(identity: RenderIdentity): RenderIdentity {
  const {
    previewMode,
    sourceRevision,
    snapshotRevision,
    annotationId,
    annotationRevision,
    citationVariant,
    citationExample,
    partialContext,
    partialProfile,
  } = identity;
  return {
    ...(previewMode === undefined ? {} : { previewMode }),
    sourceRevision,
    snapshotRevision,
    ...(annotationId === undefined ? {} : { annotationId }),
    ...(annotationRevision === undefined ? {} : { annotationRevision }),
    ...(citationVariant === undefined ? {} : { citationVariant }),
    ...(citationExample === undefined ? {} : { citationExample }),
    ...(partialContext === undefined ? {} : { partialContext }),
    ...(partialProfile === undefined ? {} : { partialProfile }),
  };
}

export function captureRenderReport({
  diagnostic,
  identity,
  trigger,
  sequence,
  capturedAt,
  context,
}: {
  readonly diagnostic: RenderDiagnostic;
  readonly identity: RenderIdentity;
  readonly trigger: "explicit" | "automatic";
  readonly sequence: number;
  readonly capturedAt: string;
  readonly context: WorkbenchReportContext;
}): RenderReport {
  const section = reportSection(diagnostic);
  const engineLocation = reportEngineLocation(diagnostic.engine);
  const caller = reportCaller(diagnostic.caller);
  const repairTarget = reportRepairTarget(
    diagnostic.sourceSite ?? diagnostic.callSite,
  );
  return {
    code: diagnostic.code,
    ...(diagnostic.evidence === undefined
      ? {}
      : { evidence: diagnostic.evidence }),
    ...(engineLocation === undefined ? {} : { engineLocation }),
    ...(caller === undefined ? {} : { caller }),
    ...(repairTarget === undefined ? {} : { repairTarget }),
    ...(section === undefined ? {} : { section }),
    capturedAt,
    trigger,
    sequence,
    identity: reportIdentity(identity),
    context,
  };
}

function field(label: string, value: string | undefined): string {
  return `${label}: ${value === undefined || value.length === 0 ? REPORT_UNAVAILABLE : value}`;
}

function block(label: string, value: string | undefined): string {
  return value === undefined || value.length === 0
    ? field(label, undefined)
    : `${label}:\n${value}`;
}

function renderOptions(identity: RenderIdentity): string | undefined {
  const options = [
    identity.previewMode === undefined ? null : `mode=${identity.previewMode}`,
    identity.citationVariant === undefined
      ? null
      : `citation variant=${identity.citationVariant}`,
    identity.citationExample === undefined
      ? null
      : `citation example=${identity.citationExample}`,
    identity.partialContext === undefined
      ? null
      : `partial context=${identity.partialContext}`,
    identity.partialProfile === undefined
      ? null
      : `partial profile=${identity.partialProfile}`,
  ].filter((option) => option !== null);
  return options.length === 0 ? undefined : options.join(", ");
}

function reportSelection(
  identity: RenderIdentity,
  context: WorkbenchReportContext,
): string | undefined {
  const parts = [
    context.selection === undefined ? null : `item=${context.selection}`,
    identity.annotationId === undefined
      ? null
      : `annotation=${identity.annotationId}@${identity.annotationRevision ?? REPORT_UNAVAILABLE}`,
  ].filter((entry) => entry !== null);
  return parts.length === 0 ? undefined : parts.join(", ");
}

export function formatRenderReport(report: RenderReport): string {
  const { evidence, identity, context } = report;
  return [
    "ZotLit template error report",
    "",
    block("Engine message", evidence?.message),
    "",
    field("Problem code", report.code),
    field("Engine name", evidence?.name),
    field("Reported location", evidence?.reportedLocation),
    field("Engine location", report.engineLocation),
    field("Calling template", report.caller),
    field("Repair target", report.repairTarget),
    field("Document section", report.section),
    "",
    block("Cause", evidence?.causes?.join("\n")),
    "",
    block("Source excerpt", evidence?.context),
    "",
    block("Stack", evidence?.stack),
    "",
    field("Captured at", report.capturedAt),
    field("Trigger", report.trigger),
    field(
      "Attempt",
      report.sequence === undefined ? undefined : String(report.sequence),
    ),
    field("Template document", context.document),
    field("Template language", context.language),
    field("Rendering root", context.root),
    field("Render options", renderOptions(identity)),
    field("Selection", reportSelection(identity, context)),
    field("Source revision", identity.sourceRevision),
    field("Snapshot revision", identity.snapshotRevision),
    field("ZotLit version", context.zotlitVersion),
    field("Host version", context.hostVersion),
    field("Engine version", context.engineVersion),
  ].join("\n");
}
