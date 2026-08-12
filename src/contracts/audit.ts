export const AUDIT_EVENT_CONTRACT_VERSION = "service-lasso.audit-event.v1" as const;
export const AUDIT_EVENT_KIND = "durable-audit" as const;

export type AuditEventContractVersion = typeof AUDIT_EVENT_CONTRACT_VERSION;
export type AuditEventKind = typeof AUDIT_EVENT_KIND;

export type AuditEventSource =
  | "runtime"
  | "service"
  | "service-admin"
  | "secrets-broker"
  | "operator"
  | "workflow"
  | "system";

export type AuditEventOutcome = "success" | "failure" | "denied" | "skipped";

export type AuditSubjectType =
  | "runtime"
  | "service"
  | "service-config"
  | "service-meta"
  | "operator-action"
  | "operator-confirmation"
  | "setup-step"
  | "recovery-check"
  | "update"
  | "workflow"
  | "workflow-run"
  | "broker-ref"
  | "provider";

export type AuditActorType = "system" | "operator" | "service" | "agent" | "unknown";
export type AuditHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AuditChainStatus = "verified" | "broken" | "unavailable";

export type AuditSafeMetadataValue =
  | string
  | number
  | boolean
  | null
  | AuditSafeMetadataValue[]
  | { [key: string]: AuditSafeMetadataValue };

export interface AuditActor {
  type: AuditActorType;
  id: string;
  source?: string;
  display?: string;
}

export interface AuditTamperEvidence {
  chainId?: string;
  sequence?: number;
  previousHash?: string;
  eventHash?: string;
  chainStatus?: AuditChainStatus;
}

export type AuditUnsafeFieldGuard = {
  password?: never;
  token?: never;
  secret?: never;
  authorization?: never;
  cookie?: never;
  privateKey?: never;
  body?: never;
  raw?: never;
};

export interface AuditEventBase {
  contractVersion: AuditEventContractVersion;
  kind: AuditEventKind;
  id: string;
  timestamp: string;
  source: AuditEventSource;
  actor: AuditActor;
  action: string;
  outcome: AuditEventOutcome;
  subjectType: AuditSubjectType;
  subjectId?: string;
  serviceId?: string;
  routeTemplate?: string;
  method?: AuditHttpMethod;
  statusCode?: number;
  summary: string;
  reason?: string;
  correlationId?: string;
  traceId?: string;
  relatedRevisionId?: string;
  metadata?: Record<string, AuditSafeMetadataValue>;
}

export type AuditEvent = AuditEventBase & AuditTamperEvidence;

export type AuditEventInput = AuditUnsafeFieldGuard &
  Omit<AuditEventBase, "contractVersion" | "kind" | "id" | "timestamp"> &
  Partial<Pick<AuditEventBase, "id" | "timestamp">> &
  AuditTamperEvidence;

export interface AuditReadResponse {
  events: AuditEvent[];
  nextCursor: string | null;
  source: "runtime-audit";
  chainStatus: AuditChainStatus | "mixed";
  rawMaterialReturned: false;
}

export function defineAuditEventInput(input: AuditEventInput): AuditEventInput {
  return input;
}
