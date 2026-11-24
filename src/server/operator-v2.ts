export const OPERATOR_V2_CONTRACT = "service-lasso-operator.v2" as const;

export interface OperatorV2ServiceInput {
  id: string;
  name: string;
  description?: string;
  definitionRevision?: string;
  generation?: string;
  modelEpoch?: string;
  running?: boolean;
  dependencies?: Array<{ fromServiceId: string; toServiceId: string; kind: string; state: string }>;
  endpoints?: Array<{ label: string; protocol: string; port: number | null; availability: OperatorV2Availability }>;
  setupMetadata?: unknown[];
  actionMetadata?: unknown[];
}

export interface OperatorV2Availability {
  supported: boolean;
  available: boolean;
  reasonCode: string | null;
}

export interface OperatorV2Capability {
  id: string;
  availability: OperatorV2Availability;
  requiredProfile: "observer" | "operator" | "maintainer" | "administrator";
  requiredScopes: string[];
  confirmationPolicy: "none" | "required";
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

function readCapability(id: string, scopes: string[] = READ_SCOPES, admitted = true): OperatorV2Capability {
  return {
    id,
    availability: admitted ? available() : { supported: true, available: false, reasonCode: "permission_denied" },
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

export function buildOperatorV2Discovery(permissions: readonly string[] = ["*"]): OperatorV2Discovery {
  const all = permissions.includes("*");
  const read = all || permissions.includes("workspace:read");
  const logs = all || permissions.includes("service:diagnose");
  return {
    metadataRevision: "operator-v2-metadata-1",
    modelEpoch: "operator-v2-epoch-1",
    supportedJourneys: ["overview", "detail", "graph", "logs"],
    mutationSemantics: "unavailable",
    limits: { ...V2_LIMITS },
    capabilities: [
      readCapability("read_overview", READ_SCOPES, read),
      readCapability("read_detail", READ_SCOPES, read),
      readCapability("read_graph", READ_SCOPES, read),
      readCapability("read_logs", ["service-lasso:read", "service-lasso:logs:read"], logs),
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
    modelEpoch: input.modelEpoch ?? "operator-v2-epoch-1",
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
    dependencies: [...(input.dependencies ?? [])],
    endpoints: [...(input.endpoints ?? [])],
    variableMetadata: [],
    setupMetadata: [...(input.setupMetadata ?? [])],
    actionMetadata: [...(input.actionMetadata ?? [])],
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

export function buildOperatorV2Cancel(operation: OperatorV2Operation, status: string): {
  operationId: string;
  actionId: string;
  status: string;
} {
  return { operationId: operation.operationId, actionId: operation.actionId, status };
}

export interface OperatorV2Preview {
  planId: string;
  serviceId: string;
  actionId: string;
  definitionRevision: string;
  expectedRevision: string;
  generation: string;
  modelEpoch: string;
  targets: string[];
  effects: string[];
  availability: OperatorV2Availability;
  confirmation: {
    required: boolean;
    id: string | null;
    phraseKey: string | null;
    expiresAt: string | null;
  };
  expiresAt: string;
}

const MUTATION_CAPABILITIES = [
  "service_install",
  "service_configure",
  "service_start",
  "service_stop",
  "service_restart",
  "update_check",
  "update_download",
  "service_reload",
] as const;

export function buildOperatorV2LifecycleAvailabilityReady(
  serviceId: string,
  definitionRevision = "definition-1",
  generation = "generation-1",
  modelEpoch = "operator-v2-epoch-1",
): {
  serviceId: string;
  definitionRevision: string;
  generation: string;
  modelEpoch: string;
  capabilities: OperatorV2Capability[];
  mutationBindings: Array<{
    actionId: string;
    expectedRevision: string | null;
    availability: OperatorV2Availability;
  }>;
  availability: OperatorV2Availability;
} {
  const capabilities: OperatorV2Capability[] = [];
  const mutationBindings: Array<{
    actionId: string;
    expectedRevision: string | null;
    availability: OperatorV2Availability;
  }> = [];
  for (const id of MUTATION_CAPABILITIES) {
    if (id === "service_reload") {
      const reloadAvailability = unsupported();
      capabilities.push({
        id,
        availability: reloadAvailability,
        requiredProfile: "operator",
        requiredScopes: READ_SCOPES,
        confirmationPolicy: "required",
        bindingRequirements: [],
      });
      mutationBindings.push({ actionId: id, expectedRevision: null, availability: reloadAvailability });
      continue;
    }
    const mutationAvailability = available();
    capabilities.push({
      id,
      availability: mutationAvailability,
      requiredProfile: "operator",
      requiredScopes: ["service-lasso:read", "service-lasso:lifecycle:write"],
      confirmationPolicy: "required",
      bindingRequirements: ["definition_revision", "runtime_generation", "model_epoch"],
    });
    mutationBindings.push({
      actionId: id,
      expectedRevision: definitionRevision,
      availability: mutationAvailability,
    });
  }
  return {
    serviceId,
    definitionRevision,
    generation,
    modelEpoch,
    capabilities,
    mutationBindings,
    availability: available(),
  };
}

export function buildOperatorV2Preview(input: {
  serviceId: string;
  actionId: string;
  definitionRevision: string;
  expectedRevision: string;
  generation: string;
  modelEpoch: string;
  planId: string;
  targets: string[];
  effects: string[];
  confirmationId: string | null;
  confirmationPhrase: string | null;
  confirmationExpiresAt: string | null;
  expiresAt: string;
}): OperatorV2Preview {
  return {
    planId: input.planId,
    serviceId: input.serviceId,
    actionId: input.actionId,
    definitionRevision: input.definitionRevision,
    expectedRevision: input.expectedRevision,
    generation: input.generation,
    modelEpoch: input.modelEpoch,
    targets: [...input.targets],
    effects: [...input.effects],
    availability: available(),
    confirmation: {
      required: input.confirmationId !== null && input.confirmationPhrase !== null,
      id: input.confirmationId,
      phraseKey: input.confirmationPhrase,
      expiresAt: input.confirmationExpiresAt,
    },
    expiresAt: input.expiresAt,
  };
}

export function operatorV2ActionToGuarded(actionId: string): string | null {
  const actions: Record<string, string> = {
    service_install: "install",
    service_configure: "config",
    service_start: "start",
    service_stop: "stop",
    service_restart: "restart",
    update_check: "update_check",
    update_download: "update_download",
  };
  return actions[actionId] ?? null;
}

export function operatorV2ActionFromPhrase(phrase: string | null): string | null {
  if (!phrase || !phrase.startsWith("confirm ")) return null;
  const actionId = phrase.slice("confirm ".length).split(" ")[0];
  return actionId && actionId in {
    "service-install": true,
    "service-configure": true,
    "service-start": true,
    "service-stop": true,
    "service-restart": true,
    "update-check": true,
    "update-download": true,
  } ? actionId.replaceAll("-", "_") : null;
}

export function buildOperatorV2LifecycleAvailabilityFromActions(
  serviceId: string,
  definitionRevision: string,
  generation: string,
  modelEpoch: string,
  actions: Readonly<Record<string, { available: boolean; reasonCode?: string | null }>>,
): ReturnType<typeof buildOperatorV2LifecycleAvailabilityReady> {
  const ids: Array<[string, string]> = [
    ["service_install", "install"],
    ["service_configure", "config"],
    ["service_start", "start"],
    ["service_stop", "stop"],
    ["service_restart", "restart"],
    ["update_check", "update_check"],
    ["update_download", "update_download"],
    ["service_reload", "reload"],
  ];
  const capabilities: OperatorV2Capability[] = [];
  const mutationBindings: Array<{
    actionId: string;
    expectedRevision: string | null;
    availability: OperatorV2Availability;
  }> = [];
  for (const [id, action] of ids) {
    if (id === "service_reload") {
      const reloadAvailability = unsupported();
      capabilities.push({
        id,
        availability: reloadAvailability,
        requiredProfile: "operator",
        requiredScopes: READ_SCOPES,
        confirmationPolicy: "required",
        bindingRequirements: [],
      });
      mutationBindings.push({ actionId: id, expectedRevision: null, availability: reloadAvailability });
      continue;
    }
    const result = actions[action] ?? { available: false, reasonCode: "dependency_blocked" };
    const reason = result.available
      ? null
      : result.reasonCode === "permission_denied" || result.reasonCode === "forbidden" || result.reasonCode === "insufficient_scope"
        ? "permission_denied"
        : result.reasonCode === "confirmation_required"
          ? "confirmation_required"
          : result.reasonCode === "authentication_required"
            ? "authentication_required"
            : "dependency_blocked";
    const availability: OperatorV2Availability = {
      supported: true,
      available: result.available,
      reasonCode: reason,
    };
    capabilities.push({
      id,
      availability,
      requiredProfile: "operator",
      requiredScopes: ["service-lasso:read", "service-lasso:lifecycle:write"],
      confirmationPolicy: "required",
      bindingRequirements: ["definition_revision", "runtime_generation", "model_epoch"],
    });
    mutationBindings.push({
      actionId: id,
      expectedRevision: result.available ? definitionRevision : null,
      availability,
    });
  }
  return {
    serviceId,
    definitionRevision,
    generation,
    modelEpoch,
    capabilities,
    mutationBindings,
    availability: available(),
  };
}
