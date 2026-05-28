import type { OperatorCommandKind, OperatorCommandRequest, OperatorCommandResponse } from "../../contracts/api.js";
import type { DiscoveredService } from "../../contracts/service.js";
import { evaluateServiceHealth } from "../health/evaluateHealth.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { DependencyGraph } from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { buildDiagnosticsBundle, buildDiagnosticsBundlePreview, redactDiagnosticsValue } from "../diagnostics/bundle.js";
import { buildRuntimeOrchestrationDryRunPlan } from "./dry-run-plan.js";
import { readServiceLogChunk } from "./logs.js";
import { buildOperatorNotifications } from "./notifications.js";
import { buildRestartSafetyPreflightReport } from "./restart-safety-preflight.js";
import { listServiceUpdateStates } from "../updates/actions.js";

const DEFAULT_LOG_TAIL_LINES = 20;
const MAX_COMMAND_LOG_TAIL_LINES = 80;

export interface OperatorCommandFacadeModel {
  discovered: DiscoveredService[];
  registry: ServiceRegistry;
  graph: DependencyGraph;
  servicesRoot: string;
  workspaceRoot: string;
  version: string;
  sharedGlobalEnv: Record<string, string>;
}

type NormalizedOperatorCommand =
  | { kind: OperatorCommandKind; serviceId?: string; tail?: number }
  | { kind: "blocked"; reason: "invalid_log_tail"; attempted: string }
  | { kind: "blocked"; reason: "mutating_command_blocked"; attempted: string }
  | { kind: "unsupported"; attempted: string };

function createResponse(input: {
  ok: boolean;
  statusCode: number;
  command: OperatorCommandResponse["command"];
  commandClass: OperatorCommandResponse["commandClass"];
  summary: string;
  data?: unknown;
  error?: OperatorCommandResponse["error"];
  redacted?: boolean;
  truncated?: boolean;
}): OperatorCommandResponse {
  return {
    contractVersion: "operator-command.v1",
    ok: input.ok,
    statusCode: input.statusCode,
    command: input.command,
    commandClass: input.commandClass,
    generatedAt: new Date().toISOString(),
    summary: input.summary,
    data: input.data ?? null,
    error: input.error ?? null,
    safety: {
      mutating: false,
      redacted: input.redacted ?? false,
      truncated: input.truncated ?? false,
      omittedSensitiveFields: [
        "environment values",
        "provider credentials",
        "secret values",
        "tokens",
        "private keys",
        "diagnostic payload contents",
      ],
    },
  };
}

function tokenizeCommand(rawCommand: string, args: string[] = []): string[] {
  return [...rawCommand.trim().split(/\s+/).filter(Boolean), ...args].map((token) => token.trim()).filter(Boolean);
}

function parseTail(tokens: string[], explicitTail?: number): { ok: true; tail: number } | { ok: false } {
  const tailIndex = tokens.indexOf("--tail");
  const tokenTail = tailIndex >= 0 ? Number(tokens[tailIndex + 1]) : undefined;
  const candidate = explicitTail ?? tokenTail ?? DEFAULT_LOG_TAIL_LINES;
  if (!Number.isFinite(candidate) || candidate < 1 || candidate > MAX_COMMAND_LOG_TAIL_LINES) {
    return { ok: false };
  }
  return { ok: true, tail: Math.trunc(candidate) };
}

function normalizeOperatorCommand(request: OperatorCommandRequest): NormalizedOperatorCommand {
  const tokens = tokenizeCommand(request.command ?? "", request.args ?? []);
  if (tokens.length === 0) {
    return { kind: "unsupported", attempted: "" };
  }

  if (tokens.length === 1 && tokens[0] === "status") {
    return { kind: "status" };
  }
  if (tokens.length === 1 && tokens[0] === "services") {
    return { kind: "services" };
  }
  if (tokens[0] === "service" && tokens[2] === "status" && tokens[1]) {
    return { kind: "service.status", serviceId: request.serviceId ?? tokens[1] };
  }
  if (tokens[0] === "service" && tokens[2] === "logs" && tokens[1]) {
    const parsedTail = parseTail(tokens, request.tail);
    if (!parsedTail.ok) {
      return { kind: "blocked", reason: "invalid_log_tail", attempted: tokens.join(" ") };
    }
    return { kind: "service.logs.tail", serviceId: request.serviceId ?? tokens[1], tail: parsedTail.tail };
  }
  if (tokens[0] === "updates" && tokens[1] === "check" && tokens.includes("--plan")) {
    return { kind: "updates.check.plan", serviceId: request.serviceId };
  }
  if (tokens[0] === "diagnostics" && tokens[1] === "bundle" && tokens.includes("--preview")) {
    return { kind: "diagnostics.bundle.preview", serviceId: request.serviceId };
  }
  if (tokens[0] === "restart" && tokens[1]) {
    if (tokens.includes("--plan")) {
      return { kind: "restart.plan", serviceId: request.serviceId ?? tokens[1] };
    }
    return { kind: "blocked", reason: "mutating_command_blocked", attempted: tokens.join(" ") };
  }
  if (["start", "stop", "install", "config", "update", "delete"].includes(tokens[0] ?? "")) {
    return { kind: "blocked", reason: "mutating_command_blocked", attempted: tokens.join(" ") };
  }

  return { kind: "unsupported", attempted: tokens.join(" ") };
}

function summarizeService(service: DiscoveredService, sharedGlobalEnv: Record<string, string>) {
  const lifecycle = getLifecycleState(service.manifest.id);
  const resolvedPorts = Object.keys(lifecycle.runtime.ports).length > 0 ? lifecycle.runtime.ports : service.manifest.ports ?? {};
  return {
    id: service.manifest.id,
    name: service.manifest.name,
    enabled: service.manifest.enabled !== false,
    running: lifecycle.running,
    installed: lifecycle.installed,
    configured: lifecycle.configured,
    ports: resolvedPorts,
    urlCount: Array.isArray(service.manifest.urls) ? service.manifest.urls.length : 0,
    envKeyCount: Object.keys(service.manifest.env ?? {}).length + Object.keys(sharedGlobalEnv).length,
  };
}

async function summarizeServiceWithHealth(service: DiscoveredService, model: OperatorCommandFacadeModel) {
  const lifecycle = getLifecycleState(service.manifest.id);
  const health = await evaluateServiceHealth(service.manifest, lifecycle, service.serviceRoot, service, model.sharedGlobalEnv);
  return {
    ...summarizeService(service, model.sharedGlobalEnv),
    health: {
      healthy: health.healthy,
      status: health.healthy ? "healthy" : "unhealthy",
      summary: health.detail,
    },
  };
}

function redactOperatorText(value: string): string {
  const redacted = String(redactDiagnosticsValue(value));
  return redacted.replace(
    /\b(api[_-]?key|auth|bearer|cookie|credential|env|password|private[_-]?key|secret|token)\b\s*[:=]\s*\S+/gi,
    "$1=[REDACTED]",
  );
}

function getServiceOrError(model: OperatorCommandFacadeModel, serviceId: string | undefined): DiscoveredService | OperatorCommandResponse {
  if (!serviceId) {
    return createResponse({
      ok: false,
      statusCode: 400,
      command: "unsupported",
      commandClass: "blocked",
      summary: "A service id is required.",
      error: { code: "missing_service_id", message: "A service id is required for this operator command." },
    });
  }

  const service = model.registry.getById(serviceId);
  if (!service) {
    return createResponse({
      ok: false,
      statusCode: 404,
      command: "unsupported",
      commandClass: "blocked",
      summary: `Unknown service id: ${serviceId}.`,
      error: { code: "service_not_found", message: `Unknown service id: ${serviceId}.` },
    });
  }
  return service;
}

export async function executeOperatorCommandFacade(
  request: OperatorCommandRequest,
  model: OperatorCommandFacadeModel,
): Promise<OperatorCommandResponse> {
  const normalized = normalizeOperatorCommand(request);

  if (normalized.kind === "blocked") {
    if (normalized.reason === "invalid_log_tail") {
      return createResponse({
        ok: false,
        statusCode: 400,
        command: "unsupported",
        commandClass: "blocked",
        summary: `Log tail requests must be between 1 and ${MAX_COMMAND_LOG_TAIL_LINES} lines.`,
        error: {
          code: "invalid_log_tail",
          message: `Command "${normalized.attempted}" requested an invalid or unbounded log tail.`,
        },
      });
    }

    return createResponse({
      ok: false,
      statusCode: 400,
      command: "unsupported",
      commandClass: "blocked",
      summary: "Mutating operator commands are blocked by this read-only facade.",
      error: {
        code: "mutating_command_blocked",
        message: `Command "${normalized.attempted}" is mutating or execution-oriented. Use a plan command instead.`,
      },
    });
  }

  if (normalized.kind === "unsupported") {
    return createResponse({
      ok: false,
      statusCode: 400,
      command: "unsupported",
      commandClass: "blocked",
      summary: "Unsupported operator command.",
      error: {
        code: normalized.attempted ? "unsupported_command" : "invalid_command",
        message: normalized.attempted ? `Unsupported operator command: ${normalized.attempted}.` : "Operator command is required.",
      },
    });
  }

  if (normalized.kind === "status") {
    const notifications = await buildOperatorNotifications(model.discovered, model.registry, model.sharedGlobalEnv);
    const serviceSummaries = await Promise.all(model.discovered.map((service) => summarizeServiceWithHealth(service, model)));
    const runningServices = serviceSummaries.filter((service) => service.running).length;
    const healthyServices = serviceSummaries.filter((service) => service.health.healthy).length;
    const severityCounts = {
      critical: notifications.filter((item) => item.severity === "critical").length,
      warning: notifications.filter((item) => item.severity === "warning").length,
      info: notifications.filter((item) => item.severity === "info").length,
    };

    return createResponse({
      ok: true,
      statusCode: 200,
      command: "status",
      commandClass: "read",
      summary: `${runningServices}/${serviceSummaries.length} services running; ${healthyServices} healthy; ${severityCounts.critical} critical notifications.`,
      data: {
        runtime: {
          version: model.version,
          servicesRoot: model.servicesRoot,
          workspaceRoot: model.workspaceRoot,
          totalServices: serviceSummaries.length,
          runningServices,
          healthyServices,
        },
        notifications: {
          severityCounts,
          top: notifications.slice(0, 5).map((item) => ({
            id: item.dedupeKey,
            severity: item.severity,
            serviceId: item.serviceId ?? null,
            title: item.message,
          })),
        },
      },
    });
  }

  if (normalized.kind === "services") {
    const services = await Promise.all(model.discovered.map((service) => summarizeServiceWithHealth(service, model)));
    return createResponse({
      ok: true,
      statusCode: 200,
      command: "services",
      commandClass: "read",
      summary: `${services.length} services discovered.`,
      data: { services },
    });
  }

  if (normalized.kind === "service.status") {
    const service = getServiceOrError(model, normalized.serviceId);
    if ("contractVersion" in service) {
      return service;
    }
    const summary = await summarizeServiceWithHealth(service, model);
    return createResponse({
      ok: true,
      statusCode: 200,
      command: "service.status",
      commandClass: "read",
      summary: `${summary.id} is ${summary.running ? "running" : "stopped"} and health is ${summary.health.status}.`,
      data: { service: summary },
    });
  }

  if (normalized.kind === "service.logs.tail") {
    const service = getServiceOrError(model, normalized.serviceId);
    if ("contractVersion" in service) {
      return service;
    }
    const chunk = await readServiceLogChunk(service, undefined, normalized.tail);
    const lines = chunk.lines.map((line) => redactOperatorText(line));
    return createResponse({
      ok: true,
      statusCode: 200,
      command: "service.logs.tail",
      commandClass: "read",
      summary: `${lines.length}/${chunk.totalLines} current log lines returned for ${service.manifest.id}.`,
      data: {
        serviceId: service.manifest.id,
        totalLines: chunk.totalLines,
        returnedLines: lines.length,
        hasMore: chunk.hasMore,
        nextCursor: chunk.nextCursor,
        lines,
      },
      redacted: lines.some((line, index) => line !== chunk.lines[index]),
      truncated: chunk.entries.some((entry) => entry.truncated) || chunk.hasMore,
    });
  }

  if (normalized.kind === "updates.check.plan") {
    const updateStates = await listServiceUpdateStates(
      normalized.serviceId ? [model.registry.getById(normalized.serviceId)].filter((service): service is DiscoveredService => Boolean(service)) : model.registry.list(),
    );
    if (normalized.serviceId && updateStates.length === 0) {
      return getServiceOrError(model, normalized.serviceId) as OperatorCommandResponse;
    }
    return createResponse({
      ok: true,
      statusCode: 200,
      command: "updates.check.plan",
      commandClass: "plan",
      summary: `Update check plan covers ${updateStates.length} service${updateStates.length === 1 ? "" : "s"} and performs no install.`,
      data: {
        dryRun: true,
        wouldCall: "/api/updates/check",
        mutatesInstallState: false,
        services: updateStates.map((entry) => ({
          serviceId: entry.serviceId,
          lastCheckStatus: entry.update.lastCheck?.status ?? null,
          downloadedCandidate: entry.update.downloadedCandidate
            ? {
                tag: entry.update.downloadedCandidate.tag,
                assetName: entry.update.downloadedCandidate.assetName,
              }
            : null,
        })),
      },
    });
  }

  if (normalized.kind === "diagnostics.bundle.preview") {
    if (normalized.serviceId && !model.registry.getById(normalized.serviceId)) {
      return getServiceOrError(model, normalized.serviceId) as OperatorCommandResponse;
    }
    const preview = buildDiagnosticsBundlePreview(await buildDiagnosticsBundle({
      servicesRoot: model.servicesRoot,
      workspaceRoot: model.workspaceRoot,
      version: model.version,
      serviceId: normalized.serviceId,
    }));
    return createResponse({
      ok: true,
      statusCode: 200,
      command: "diagnostics.bundle.preview",
      commandClass: "plan",
      summary: `Diagnostics preview covers ${preview.runtime.serviceCount} service${preview.runtime.serviceCount === 1 ? "" : "s"}; bundle contents are not returned.`,
      data: preview,
      redacted: true,
    });
  }

  if (normalized.kind === "restart.plan") {
    const service = getServiceOrError(model, normalized.serviceId);
    if ("contractVersion" in service) {
      return service;
    }
    return createResponse({
      ok: true,
      statusCode: 200,
      command: "restart.plan",
      commandClass: "plan",
      summary: `Restart plan generated for ${service.manifest.id}; no restart was executed.`,
      data: {
        dryRun: true,
        serviceId: service.manifest.id,
        restart: buildRestartSafetyPreflightReport(service, model.registry),
        orchestrationPlan: buildRuntimeOrchestrationDryRunPlan("stopAll", model.graph, model.registry).steps
          .filter((step) => step.serviceId === service.manifest.id),
      },
    });
  }

  return createResponse({
    ok: false,
    statusCode: 400,
    command: "unsupported",
    commandClass: "blocked",
    summary: "Unsupported operator command.",
    error: { code: "unsupported_command", message: "Unsupported operator command." },
  });
}
