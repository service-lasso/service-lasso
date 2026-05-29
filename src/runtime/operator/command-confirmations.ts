import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  NormalizedOperatorCommandActorEnvelope,
  OperatorCommandActorEnvelope,
  OperatorCommandConfirmationAuditEvent,
  OperatorCommandConfirmationConfirmRequest,
  OperatorCommandConfirmationIssueRequest,
  OperatorCommandConfirmationRecord,
  OperatorCommandConfirmationResponse,
} from "../../contracts/api.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import {
  normalizeOperatorCommandActor,
  OperatorActorValidationError,
} from "./command-audit.js";

const DEFAULT_CONFIRMATION_TTL_SECONDS = 300;
const MIN_CONFIRMATION_TTL_SECONDS = 30;
const MAX_CONFIRMATION_TTL_SECONDS = 900;
const CONFIRMATION_STORE_VERSION = 1;
const secretLikeValuePattern =
  /((password|passwd|secret|token|credential|cookie|private[_-]?key)\s*[:=]\s*[^\s,;]+)|(bearer\s+[A-Za-z0-9._~+/=-]+)|(gh[pousr]_[A-Za-z0-9_]+)/i;

type ConfirmationCommand = OperatorCommandConfirmationRecord["command"];

interface ConfirmationModel {
  workspaceRoot: string;
  registry: ServiceRegistry;
  trustedChatBridge?: boolean;
}

interface ParsedMutatingCommand {
  command: ConfirmationCommand;
  canonicalCommand: string;
  targetServiceId: string;
}

interface StoredConfirmationRecord extends OperatorCommandConfirmationRecord {
  confirmationPhrase: string;
}

interface ConfirmationStore {
  version: number;
  records: StoredConfirmationRecord[];
}

export class OperatorCommandConfirmationError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = "OperatorCommandConfirmationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function operatorCommandConfirmationStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".state", "operator-command-confirmations.json");
}

export function operatorCommandConfirmationAuditPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".state", "operator-command-confirmation-audit.jsonl");
}

export async function issueOperatorCommandConfirmation(
  request: OperatorCommandConfirmationIssueRequest,
  model: ConfirmationModel,
): Promise<OperatorCommandConfirmationResponse> {
  const actor = normalizeTrustedActor(request.actor, model.trustedChatBridge);
  const parsed = parseMutatingCommand(request);
  if (!model.registry.getById(parsed.targetServiceId)) {
    throw new OperatorCommandConfirmationError("service_not_found", 404, `Unknown service id: ${parsed.targetServiceId}.`);
  }

  const planId = normalizeRequiredText(request.planId, "planId");
  const planFingerprint = fingerprintPlan(request.plan);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + normalizeTtlSeconds(request.expiresInSeconds) * 1000);
  const record: StoredConfirmationRecord = {
    contractVersion: "operator-command-confirmation.v1",
    id: `operator-confirmation-${randomUUID()}`,
    status: "pending",
    command: parsed.command,
    canonicalCommand: parsed.canonicalCommand,
    targetServiceId: parsed.targetServiceId,
    planId,
    planFingerprint,
    capabilityFingerprint: fingerprintCapabilities(parsed.targetServiceId, model.registry),
    actor,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    confirmedAt: null,
    deniedAt: null,
    denialReason: null,
    executedAt: null,
    confirmationPhrase: createConfirmationPhrase(parsed.command, parsed.targetServiceId),
  };

  const store = await readConfirmationStore(model.workspaceRoot);
  store.records = [record, ...store.records.filter((entry) => entry.id !== record.id)].slice(0, 200);
  await writeConfirmationStore(model.workspaceRoot, store);
  const audit = await appendConfirmationAuditEvent(model.workspaceRoot, record, "issued", actor, null);

  return {
    contractVersion: "operator-command-confirmation-response.v1",
    ok: true,
    confirmation: publicRecord(record),
    confirmationPhrase: record.confirmationPhrase,
    audit,
  };
}

export async function confirmOperatorCommandConfirmation(
  confirmationId: string,
  request: OperatorCommandConfirmationConfirmRequest,
  model: ConfirmationModel,
): Promise<OperatorCommandConfirmationResponse> {
  const actor = normalizeTrustedActor(request.actor, model.trustedChatBridge);
  const store = await readConfirmationStore(model.workspaceRoot);
  const index = store.records.findIndex((entry) => entry.id === confirmationId);
  if (index < 0) {
    throw new OperatorCommandConfirmationError("confirmation_not_found", 404, "Confirmation record was not found.");
  }

  const record = store.records[index];
  const deny = async (code: string, statusCode: number, message: string, status: "denied" | "expired" = "denied"): Promise<never> => {
    const now = new Date().toISOString();
    record.status = status;
    record.deniedAt = status === "denied" ? now : record.deniedAt;
    record.denialReason = code;
    store.records[index] = record;
    await writeConfirmationStore(model.workspaceRoot, store);
    await appendConfirmationAuditEvent(model.workspaceRoot, record, status, actor, code);
    throw new OperatorCommandConfirmationError(code, statusCode, message);
  };

  if (record.status !== "pending") {
    throw new OperatorCommandConfirmationError("confirmation_not_pending", 409, `Confirmation is ${record.status}.`);
  }
  if (Date.parse(record.expiresAt) <= Date.now()) {
    await deny("confirmation_expired", 409, "Confirmation expired before it was confirmed.", "expired");
  }
  if (!sameActor(record.actor, actor)) {
    await deny("actor_mismatch", 403, "Confirmation must be completed by the same authorized actor.");
  }
  if (request.confirmationPhrase !== record.confirmationPhrase) {
    await deny("confirmation_phrase_mismatch", 403, "Confirmation phrase did not match.");
  }
  if (fingerprintPlan(request.plan) !== record.planFingerprint) {
    await deny("plan_changed", 409, "Dry-run plan changed before confirmation.");
  }
  if (fingerprintCapabilities(record.targetServiceId, model.registry) !== record.capabilityFingerprint) {
    await deny("capability_drift", 409, "Runtime service state changed before confirmation.");
  }

  record.status = "confirmed";
  record.confirmedAt = new Date().toISOString();
  store.records[index] = record;
  await writeConfirmationStore(model.workspaceRoot, store);
  const audit = await appendConfirmationAuditEvent(model.workspaceRoot, record, "confirmed", actor, null);

  return {
    contractVersion: "operator-command-confirmation-response.v1",
    ok: true,
    confirmation: publicRecord(record),
    audit,
  };
}

function normalizeTrustedActor(input: OperatorCommandActorEnvelope | undefined, trustedChatBridge: boolean | undefined): NormalizedOperatorCommandActorEnvelope {
  const actor = normalizeOperatorCommandActor(input);
  if (actor.source === "chat-bridge" && trustedChatBridge !== true) {
    throw new OperatorActorValidationError(
      "untrusted_chat_bridge",
      403,
      "Chat bridge actor metadata requires trusted local bridge authentication.",
    );
  }
  return actor;
}

function parseMutatingCommand(request: OperatorCommandConfirmationIssueRequest): ParsedMutatingCommand {
  const tokens = [...(request.command ?? "").trim().split(/\s+/).filter(Boolean), ...(request.args ?? [])];
  const command = tokens[0];
  const targetServiceId = request.serviceId ?? tokens[1];
  if ((command === "restart" || command === "start" || command === "stop") && targetServiceId) {
    if (tokens.includes("--plan")) {
      throw new OperatorCommandConfirmationError("plan_command_not_mutating", 400, "Confirmation records must target the mutating command, not the dry-run plan command.");
    }
    return {
      command,
      canonicalCommand: `${command} ${targetServiceId}`,
      targetServiceId,
    };
  }

  throw new OperatorCommandConfirmationError("unsupported_mutating_command", 400, "Only start, stop, and restart confirmations are supported in this slice.");
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new OperatorCommandConfirmationError("invalid_confirmation_request", 400, `"${field}" must be a non-empty string.`);
  }
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 160);
  if (secretLikeValuePattern.test(normalized)) {
    throw new OperatorCommandConfirmationError("invalid_confirmation_request", 400, `"${field}" must not contain secret-like material.`);
  }
  return normalized;
}

function normalizeTtlSeconds(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_CONFIRMATION_TTL_SECONDS;
  }
  if (!Number.isFinite(value) || typeof value !== "number") {
    throw new OperatorCommandConfirmationError("invalid_confirmation_request", 400, '"expiresInSeconds" must be a number when present.');
  }
  return Math.min(MAX_CONFIRMATION_TTL_SECONDS, Math.max(MIN_CONFIRMATION_TTL_SECONDS, Math.trunc(value)));
}

function createConfirmationPhrase(command: ConfirmationCommand, serviceId: string): string {
  return `confirm ${command} ${serviceId}`;
}

function fingerprintPlan(plan: unknown): string {
  if (plan === undefined || plan === null) {
    throw new OperatorCommandConfirmationError("invalid_plan", 400, '"plan" must be supplied for confirmation.');
  }
  const serialized = stableJson(plan);
  if (secretLikeValuePattern.test(serialized)) {
    throw new OperatorCommandConfirmationError("invalid_plan", 400, "Confirmation plans must not include secret-like material.");
  }
  return sha256(serialized);
}

function fingerprintCapabilities(serviceId: string, registry: ServiceRegistry): string {
  const service = registry.getById(serviceId);
  if (!service) {
    throw new OperatorCommandConfirmationError("service_not_found", 404, `Unknown service id: ${serviceId}.`);
  }
  const lifecycle = getLifecycleState(serviceId);
  return sha256(stableJson({
    serviceId,
    enabled: service.manifest.enabled !== false,
    version: service.manifest.version ?? null,
    dependencies: service.manifest.depend_on ?? [],
    installed: lifecycle.installed,
    configured: lifecycle.configured,
    running: lifecycle.running,
  }));
}

function sameActor(expected: NormalizedOperatorCommandActorEnvelope, actual: NormalizedOperatorCommandActorEnvelope): boolean {
  return expected.source === actual.source
    && expected.actorId === actual.actorId
    && (expected.channel ?? null) === (actual.channel ?? null)
    && (expected.chatId ?? null) === (actual.chatId ?? null)
    && (expected.senderId ?? null) === (actual.senderId ?? null);
}

function publicRecord(record: StoredConfirmationRecord): OperatorCommandConfirmationRecord {
  const { confirmationPhrase: _confirmationPhrase, ...rest } = record;
  return rest;
}

async function readConfirmationStore(workspaceRoot: string): Promise<ConfirmationStore> {
  try {
    const raw = await readFile(operatorCommandConfirmationStorePath(workspaceRoot), "utf8");
    const parsed = JSON.parse(raw) as Partial<ConfirmationStore>;
    return {
      version: CONFIRMATION_STORE_VERSION,
      records: Array.isArray(parsed.records) ? parsed.records as StoredConfirmationRecord[] : [],
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { version: CONFIRMATION_STORE_VERSION, records: [] };
    }
    throw error;
  }
}

async function writeConfirmationStore(workspaceRoot: string, store: ConfirmationStore): Promise<void> {
  const targetPath = operatorCommandConfirmationStorePath(workspaceRoot);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify({ version: CONFIRMATION_STORE_VERSION, records: store.records }, null, 2) + "\n", "utf8");
}

async function appendConfirmationAuditEvent(
  workspaceRoot: string,
  record: StoredConfirmationRecord,
  event: OperatorCommandConfirmationAuditEvent["event"],
  actor: NormalizedOperatorCommandActorEnvelope,
  errorCode: string | null,
): Promise<OperatorCommandConfirmationAuditEvent> {
  const audit: OperatorCommandConfirmationAuditEvent = {
    contractVersion: "operator-command-confirmation-audit.v1",
    id: `operator-confirmation-audit-${Date.now()}-${randomUUID()}`,
    at: new Date().toISOString(),
    confirmationId: record.id,
    event,
    resultStatus: errorCode ? "denied" : "success",
    errorCode,
    actorId: actor.actorId,
    channel: actor.channel ?? null,
    chatId: actor.chatId ?? null,
    senderId: actor.senderId ?? null,
    sourceMessageId: actor.sourceMessageId ?? null,
    command: record.command,
    targetServiceId: record.targetServiceId,
    planId: record.planId,
  };
  if (secretLikeValuePattern.test(JSON.stringify(audit))) {
    throw new Error("Operator command confirmation audit metadata must not include raw tokens, cookies, secrets, credentials, or private keys");
  }
  const auditPath = operatorCommandConfirmationAuditPath(workspaceRoot);
  await mkdir(path.dirname(auditPath), { recursive: true });
  await appendFile(auditPath, JSON.stringify(audit) + "\n", "utf8");
  return audit;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => stableJson(entry)).join(",") + "]";
  }
  return "{" + Object.keys(value as Record<string, unknown>).sort()
    .map((key) => JSON.stringify(key) + ":" + stableJson((value as Record<string, unknown>)[key]))
    .join(",") + "}";
}
