import { randomUUID } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type {
  NormalizedOperatorCommandActorEnvelope,
  OperatorCommandActorSource,
  OperatorCommandAuditEvent,
  OperatorCommandChatChannel,
  OperatorCommandResponse,
} from "../../contracts/api.js";

const MAX_SAFE_TEXT_LENGTH = 160;
const secretLikeValuePattern =
  /((password|passwd|secret|token|credential|cookie|private[_-]?key)\s*[:=]\s*[^\s,;]+)|(bearer\s+[A-Za-z0-9._~+/=-]+)|(gh[pousr]_[A-Za-z0-9_]+)/i;

export class OperatorActorValidationError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = "OperatorActorValidationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function operatorCommandAuditPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".state", "operator-command-audit.jsonl");
}

export function normalizeOperatorCommandActor(input: unknown): NormalizedOperatorCommandActorEnvelope {
  if (input === undefined || input === null) {
    return {
      source: "api",
      actorId: "api:local",
      roles: [],
    };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OperatorActorValidationError("invalid_actor", 400, '"actor" must be an object when present.');
  }

  const candidate = input as Record<string, unknown>;
  const source = expectSource(candidate.source);
  const channel = candidate.channel === undefined || candidate.channel === null ? undefined : expectChannel(candidate.channel);
  if (source === "chat-bridge" && !channel) {
    throw new OperatorActorValidationError("invalid_actor", 400, 'Chat bridge actor metadata requires "channel".');
  }

  const actorId = normalizeSafeText(
    candidate.actorId,
    source === "chat-bridge" && channel && typeof candidate.senderId === "string"
      ? `${channel}:${candidate.senderId}`
      : `${source}:local`,
    "actor.actorId",
  );
  const roles = normalizeRoles(candidate.roles);
  const actor: NormalizedOperatorCommandActorEnvelope = {
    source,
    actorId,
    roles,
    channel,
    chatId: optionalSafeText(candidate.chatId, "actor.chatId"),
    senderId: optionalSafeText(candidate.senderId, "actor.senderId"),
    senderDisplay: optionalSafeText(candidate.senderDisplay, "actor.senderDisplay"),
    sourceMessageId: optionalSafeText(candidate.sourceMessageId, "actor.sourceMessageId"),
    planId: optionalSafeText(candidate.planId, "actor.planId"),
    confirmationId: optionalSafeText(candidate.confirmationId, "actor.confirmationId"),
  };

  if (actor.source === "chat-bridge" && (!actor.chatId || !actor.senderId)) {
    throw new OperatorActorValidationError("invalid_actor", 400, "Chat bridge actor metadata requires chatId and senderId.");
  }
  if (operatorActorIncludesSecretMaterial(actor)) {
    throw new OperatorActorValidationError("invalid_actor", 400, "Actor metadata must not include tokens, cookies, secrets, credentials, or private keys.");
  }
  return actor;
}

export function buildOperatorCommandAuditEvent(input: {
  actor: NormalizedOperatorCommandActorEnvelope;
  response: Omit<OperatorCommandResponse, "audit">;
  targetServiceId?: string | null;
}): OperatorCommandAuditEvent {
  const at = input.response.generatedAt;
  const event: OperatorCommandAuditEvent = {
    contractVersion: "operator-command-audit.v1",
    id: `operator-command-${Date.parse(at)}-${randomUUID()}`,
    at,
    source: input.actor.source,
    actorId: input.actor.actorId,
    roles: [...input.actor.roles],
    channel: input.actor.channel ?? null,
    chatId: input.actor.chatId ?? null,
    senderId: input.actor.senderId ?? null,
    senderDisplay: input.actor.senderDisplay ?? null,
    sourceMessageId: input.actor.sourceMessageId ?? null,
    command: input.response.command,
    commandClass: input.response.commandClass,
    targetServiceId: input.targetServiceId ?? null,
    resultStatus: input.response.ok ? "success" : input.response.error?.code === "mutating_command_blocked" ? "denied" : "failed",
    statusCode: input.response.statusCode,
    errorCode: input.response.error?.code ?? null,
    redacted: input.response.safety.redacted,
    truncated: input.response.safety.truncated,
    planId: input.actor.planId ?? null,
    confirmationId: input.actor.confirmationId ?? null,
  };
  if (operatorCommandAuditIncludesSecretMaterial(event)) {
    throw new Error("Operator command audit metadata must not include raw tokens, cookies, secrets, credentials, or private keys");
  }
  return event;
}

export async function appendOperatorCommandAuditEvent(workspaceRoot: string, event: OperatorCommandAuditEvent): Promise<void> {
  const auditPath = operatorCommandAuditPath(workspaceRoot);
  await mkdir(path.dirname(auditPath), { recursive: true });
  await appendFile(auditPath, JSON.stringify(event) + "\n", "utf8");
}

export function operatorCommandAuditIncludesSecretMaterial(event: OperatorCommandAuditEvent): boolean {
  return secretLikeValuePattern.test(JSON.stringify(event));
}

function expectSource(value: unknown): OperatorCommandActorSource {
  if (value === "api" || value === "shell" || value === "web" || value === "chat-bridge") {
    return value;
  }
  throw new OperatorActorValidationError("invalid_actor", 400, '"actor.source" must be api, shell, web, or chat-bridge.');
}

function expectChannel(value: unknown): OperatorCommandChatChannel {
  if (value === "telegram" || value === "custom") {
    return value;
  }
  throw new OperatorActorValidationError("invalid_actor", 400, '"actor.channel" must be telegram or custom.');
}

function normalizeRoles(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new OperatorActorValidationError("invalid_actor", 400, '"actor.roles" must be an array of strings when present.');
  }
  return value.map((entry) => normalizeSafeText(entry, "", "actor.roles")).filter(Boolean).slice(0, 20);
}

function optionalSafeText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return normalizeSafeText(value, "", field);
}

function normalizeSafeText(value: unknown, fallback: string, field: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new OperatorActorValidationError("invalid_actor", 400, `"${field}" must be a string when present.`);
  }
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, MAX_SAFE_TEXT_LENGTH);
  if (secretLikeValuePattern.test(normalized)) {
    throw new OperatorActorValidationError("invalid_actor", 400, "Actor metadata must not include tokens, cookies, secrets, credentials, or private keys.");
  }
  return normalized || fallback;
}

function operatorActorIncludesSecretMaterial(actor: NormalizedOperatorCommandActorEnvelope): boolean {
  return secretLikeValuePattern.test(JSON.stringify(actor));
}
