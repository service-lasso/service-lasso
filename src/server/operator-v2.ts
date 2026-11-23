export const OPERATOR_V2_CONTRACT = "service-lasso-operator.v2" as const;

export interface OperatorV2ServiceInput {
  id: string;
  name: string;
  description?: string;
  definitionRevision?: string;
  generation?: string;
  running?: boolean;
}

export interface OperatorV2Availability {
  supported: boolean;
  available: boolean;
  reasonCode: string | null;
}

export interface OperatorV2Capability {
  id: string;
  availability: OperatorV2Availability;
  requiredProfile: "observer";
  requiredScopes: string[];
  confirmationPolicy: "none";
  bindingRequirements: string[];
}

export interface OperatorV2Discovery {
  metadataRevision: string;
  modelEpoch: string;
  supportedJourneys: string[];
  mutationSemantics: "unavailable";
  limits: {
    requestBytes: number;
    responseBytes: number;
    errorBytes: number;
    depth: number;
    totalValues: number;
    propertyNameBytes: number;
    publicStringBytes: number;
    idBytes: number;
    summaryBytes: number;
    displayNameBytes: number;
    descriptionBytes: number;
    pageRows: number;
    contextBytes: number;
  };
  capabilities: OperatorV2Capability[];
}

export interface OperatorV2Service {
  serviceId: string;
  displayName: string;
  description: string;
  definitionRevision: string;
  generation: string;
  modelEpoch: string;
  installed: "yes" | "no" | "unknown";
  configured: "yes" | "no" | "unknown";
  running: "yes" | "no" | "unknown";
  healthStatus: "healthy" | "unhealthy" | "unknown" | "not_configured";
  updateStatus: string;
  capabilityIds: string[];
}

export interface OperatorV2Page<T> {
  snapshotId: string;
  sourceRevision: string;
  rows: T[];
  nextCursor: string | null;
  expiresAt: string;
  truncated: boolean;
}

const READ_SCOPES = ["service-lasso:read"];
const V2_LIMITS = Object.freeze({
  requestBytes: 65536,
  responseBytes: 262144,
  errorBytes: 8192,
  depth: 16,
  totalValues: 8192,
  propertyNameBytes: 128,
  publicStringBytes: 4096,
  idBytes: 128,
  summaryBytes: 512,
  displayNameBytes: 256,
  descriptionBytes: 1024,
  pageRows: 100,
  contextBytes: 4096,
});

function available(): OperatorV2Availability {
  return { supported: true, available: true, reasonCode: null };
}

function unsupported(): OperatorV2Availability {
  return { supported: false, available: false, reasonCode: "unsupported_capability" };
}

function readCapability(id: string, scopes: string[] = READ_SCOPES): OperatorV2Capability {
  return {
    id,
    availability: available(),
    requiredProfile: "observer",
    requiredScopes: scopes,
    confirmationPolicy: "none",
    bindingRequirements: [],
  };
}

export function operatorV2Envelope<T>(data: T, requestId: string, generatedAt = new Date()): {
  contractVersion: typeof OPERATOR_V2_CONTRACT;
  requestId: string;
  generatedAt: string;
  data: T;
} {
  return {
    contractVersion: OPERATOR_V2_CONTRACT,
    requestId,
    generatedAt: generatedAt.toISOString(),
    data,
  };
}

export function buildOperatorV2Discovery(): OperatorV2Discovery {
  return {
    metadataRevision: "operator-v2-metadata-1",
    modelEpoch: "operator-v2-epoch-1",
    supportedJourneys: ["overview", "detail", "graph", "logs"],
    mutationSemantics: "unavailable",
    limits: { ...V2_LIMITS },
    capabilities: [
      readCapability("read_overview"),
      readCapability("read_detail"),
      readCapability("read_graph"),
      readCapability("read_logs", ["service-lasso:read", "service-lasso:logs:read"]),
    ],
  };
}

export function buildOperatorV2Service(input: OperatorV2ServiceInput): OperatorV2Service {
  return {
    serviceId: input.id,
    displayName: input.name,
    description: input.description ?? "",
    definitionRevision: input.definitionRevision ?? "definition-1",
    generation: input.generation ?? "generation-1",
    modelEpoch: "operator-v2-epoch-1",
    installed: "yes",
    configured: "unknown",
    running: input.running === true ? "yes" : input.running === false ? "no" : "unknown",
    healthStatus: "unknown",
    updateStatus: "not_checked",
    capabilityIds: ["read_overview", "read_detail"],
  };
}

export function buildOperatorV2ServicesPage(
  services: readonly OperatorV2ServiceInput[],
  options: { sourceRevision?: string; snapshotId?: string; expiresAt?: Date } = {},
): OperatorV2Page<OperatorV2Service> {
  return {
    snapshotId: options.snapshotId ?? "operator-v2-snapshot-1",
    sourceRevision: options.sourceRevision ?? "operator-v2-source-1",
    rows: services.slice(0, 100).map(buildOperatorV2Service),
    nextCursor: null,
    expiresAt: (options.expiresAt ?? new Date(Date.now() + 60_000)).toISOString(),
    truncated: false,
  };
}

export function buildOperatorV2Detail(input: OperatorV2ServiceInput): {
  summary: OperatorV2Service;
  provider: { role: "service"; availability: OperatorV2Availability };
  dependencies: unknown[];
  endpoints: unknown[];
  variableMetadata: unknown[];
  setupMetadata: unknown[];
  actionMetadata: unknown[];
} {
  return {
    summary: buildOperatorV2Service(input),
    provider: { role: "service", availability: available() },
    dependencies: [],
    endpoints: [],
    variableMetadata: [],
    setupMetadata: [],
    actionMetadata: [],
  };
}

export function buildOperatorV2LifecycleAvailability(serviceId: string): {
  serviceId: string;
  definitionRevision: null;
  generation: null;
  modelEpoch: null;
  capabilities: [];
  mutationBindings: [];
  availability: OperatorV2Availability;
} {
  return {
    serviceId,
    definitionRevision: null,
    generation: null,
    modelEpoch: null,
    capabilities: [],
    mutationBindings: [],
    availability: unsupported(),
  };
}

export interface OperatorV2Operation {
  operationId: string;
  actionId: string;
  serviceId: string;
  targets: string[];
  status: string;
  phase: string;
  outcome: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  cancellationSupported: boolean;
}

export function buildOperatorV2Operation(input: {
  operationId: string;
  action: string;
  targetIds: readonly string[];
  status: string;
  phase: string;
  outcome: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  cancellationSupported: boolean;
}): OperatorV2Operation {
  const serviceId = input.targetIds[0];
  if (!serviceId) throw new Error("operator operation has no target service");
  return {
    operationId: input.operationId,
    actionId: input.action,
    serviceId,
    targets: [...input.targetIds],
    status: input.status,
    phase: input.phase,
    outcome: input.outcome,
    correlationId: input.correlationId,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    expiresAt: input.expiresAt,
    cancellationSupported: input.cancellationSupported,
  };
}

export function buildOperatorV2Readback(operation: OperatorV2Operation): { operation: OperatorV2Operation } {
  return { operation };
}
