const CONTRACT_VERSION = "service-lasso-durable-lifecycle-operation.v1";

export type DurableOperatorAction = "install" | "config" | "start" | "stop" | "restart";
export type DurableOperatorRead = "services" | "health" | "setup" | "dependencies";
export type DurableOperatorCommand = DurableOperatorAction | "available-actions" | "inspect" | "wait" | "cancel" | DurableOperatorRead;

export interface DurableOperatorInput {
  command: DurableOperatorCommand;
  serviceId?: string;
  operationId?: string;
  idempotencyKey?: string;
  confirm?: boolean;
  waitMs?: number;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
}

export interface DurableOperatorResult {
  schema: "service-lasso.durable-operator-cli.v1";
  status: "accepted" | "succeeded" | "failed" | "cancelled" | "timeout" | "uncertain" | "rejected" | "unsupported" | "read";
  exitCode: number;
  operationId: string | null;
  idempotencyKey: string | null;
  data: Record<string, unknown> | null;
  error: string | null;
}

const MUTATIONS = new Set<DurableOperatorAction>(["install", "config", "start", "stop", "restart"]);
const READ_PATHS: Record<DurableOperatorRead, string> = {
  services: "/api/services",
  health: "/api/health",
  setup: "/api/setup/status",
  dependencies: "/api/dependencies",
};

function result(status: DurableOperatorResult["status"], exitCode: number, values: Partial<DurableOperatorResult> = {}): DurableOperatorResult {
  return { schema: "service-lasso.durable-operator-cli.v1", status, exitCode, operationId: null, idempotencyKey: null, data: null, error: null, ...values };
}

function endpoint(env: NodeJS.ProcessEnv): URL {
  const raw = env.SERVICE_LASSO_OPERATOR_API_URL;
  if (!raw) throw new Error("SERVICE_LASSO_OPERATOR_API_URL is required.");
  const url = new URL(raw);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Operator endpoint must use HTTPS or loopback HTTP.");
  return url;
}

function client(fetchImpl: typeof globalThis.fetch, env: NodeJS.ProcessEnv) {
  const base = endpoint(env);
  const token = env.SERVICE_LASSO_OPERATOR_TOKEN;
  return async (path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await fetchImpl(new URL(path, base), {
      ...init,
      redirect: "error",
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
    let body: unknown;
    try { body = await response.json(); } catch { body = {}; }
    return { status: response.status, body: body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {} };
  };
}

function operationIdOf(body: Record<string, unknown>): string | null {
  const operation = body.operation;
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return null;
  const id = (operation as Record<string, unknown>).operationId;
  return typeof id === "string" ? id : null;
}

function terminalResult(body: Record<string, unknown>, operationId: string, idempotencyKey: string | null): DurableOperatorResult | null {
  const operation = body.operation;
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return null;
  const outcome = (operation as Record<string, unknown>).outcome;
  if (outcome === null || outcome === undefined) return null;
  if (outcome === "succeeded" || outcome === "skipped") return result("succeeded", 0, { operationId, idempotencyKey, data: body });
  if (outcome === "cancelled") return result("cancelled", 21, { operationId, idempotencyKey, data: body });
  if (outcome === "unknown_after_crash") return result("uncertain", 23, { operationId, idempotencyKey, data: body });
  return result("failed", 20, { operationId, idempotencyKey, data: body });
}

async function inspect(request: ReturnType<typeof client>, operationId: string, idempotencyKey: string | null): Promise<DurableOperatorResult> {
  try {
    const response = await request(`/api/operator/lifecycle/operations/${encodeURIComponent(operationId)}`);
    if (response.status !== 200) return result("rejected", 25, { operationId, idempotencyKey, error: "operation_read_failed" });
    return terminalResult(response.body, operationId, idempotencyKey) ?? result("accepted", 10, { operationId, idempotencyKey, data: response.body });
  } catch {
    return result("uncertain", 23, { operationId, idempotencyKey, error: "operation_read_uncertain" });
  }
}

export async function runDurableOperator(input: DurableOperatorInput): Promise<DurableOperatorResult> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetch ?? globalThis.fetch;
  let request: ReturnType<typeof client>;
  try { request = client(fetchImpl, env); } catch (error) { return result("rejected", 25, { error: error instanceof Error ? error.message : "operator_configuration_invalid" }); }

  if (input.command in READ_PATHS) {
    try {
      const response = await request(READ_PATHS[input.command as DurableOperatorRead]);
      return response.status === 200 ? result("read", 0, { data: response.body }) : result("rejected", 25, { error: "read_failed" });
    } catch { return result("uncertain", 23, { error: "read_uncertain" }); }
  }
  if (input.command === "available-actions") {
    if (!input.serviceId) return result("rejected", 25, { error: "service_id_required" });
    try {
      const response = await request(`/api/operator/lifecycle/services/${encodeURIComponent(input.serviceId)}/availability`);
      if (response.status !== 200 || response.body.contractVersion !== CONTRACT_VERSION) return result("unsupported", 24, { error: "durable_contract_unavailable" });
      return result("read", 0, { data: response.body });
    } catch { return result("uncertain", 23, { error: "availability_uncertain" }); }
  }
  if (input.command === "inspect") {
    return input.operationId ? inspect(request, input.operationId, null) : result("rejected", 25, { error: "operation_id_required" });
  }
  if (input.command === "wait") {
    if (!input.operationId) return result("rejected", 25, { error: "operation_id_required" });
    const deadline = Date.now() + Math.max(1, Math.min(input.waitMs ?? 30_000, 300_000));
    while (Date.now() < deadline) {
      const current = await inspect(request, input.operationId, null);
      if (current.status !== "accepted") return current;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return result("timeout", 22, { operationId: input.operationId, error: "wait_expired" });
  }
  if (input.command === "cancel") {
    if (!input.operationId) return result("rejected", 25, { error: "operation_id_required" });
    try {
      const response = await request(`/api/operator/lifecycle/operations/${encodeURIComponent(input.operationId)}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const cancellation = response.body.cancellation;
      if (response.status !== 200 || !cancellation || typeof cancellation !== "object") return result("unsupported", 24, { operationId: input.operationId, error: "cancellation_unavailable" });
      const cancelled = (cancellation as Record<string, unknown>).result === "cancelled";
      return result(cancelled ? "cancelled" : "accepted", cancelled ? 21 : 10, { operationId: input.operationId, data: response.body });
    } catch { return result("uncertain", 23, { operationId: input.operationId, error: "cancellation_uncertain" }); }
  }
  if (!MUTATIONS.has(input.command as DurableOperatorAction) || !input.serviceId || !input.idempotencyKey || !input.confirm) return result("rejected", 25, { error: "action_service_idempotency_key_and_confirm_required", idempotencyKey: input.idempotencyKey ?? null });
  const action = input.command as DurableOperatorAction;
  try {
    const availability = await request(`/api/operator/lifecycle/services/${encodeURIComponent(input.serviceId)}/availability`);
    if (availability.status !== 200 || availability.body.contractVersion !== CONTRACT_VERSION) return result("unsupported", 24, { idempotencyKey: input.idempotencyKey, error: "durable_contract_unavailable" });
    const actions = availability.body.actions;
    const advertised = Array.isArray(actions) && actions.find((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).action === action);
    if (!advertised || (advertised as Record<string, unknown>).available !== true) return result("unsupported", 24, { idempotencyKey: input.idempotencyKey, error: "action_not_available" });
    const preview = await request("/api/operator/lifecycle/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, serviceId: input.serviceId }) });
    const confirmation = preview.body.confirmation as Record<string, unknown> | undefined;
    if (preview.status !== 200 || !confirmation || typeof confirmation.id !== "string" || typeof confirmation.confirmationPhrase !== "string") return result("rejected", 25, { idempotencyKey: input.idempotencyKey, error: "server_confirmation_required" });
    const accepted = await request("/api/operator/lifecycle/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, serviceId: input.serviceId, execute: true, idempotencyKey: input.idempotencyKey, confirmationId: confirmation.id, confirmationPhrase: confirmation.confirmationPhrase }) });
    const operationId = operationIdOf(accepted.body);
    if (accepted.status !== 202 || !operationId) return result("rejected", 25, { idempotencyKey: input.idempotencyKey, error: "operation_not_accepted" });
    if (input.waitMs === undefined) return result("accepted", 10, { operationId, idempotencyKey: input.idempotencyKey, data: accepted.body });
    return await runDurableOperator({ command: "wait", operationId, waitMs: input.waitMs, env, fetch: fetchImpl });
  } catch {
    return result("uncertain", 23, { idempotencyKey: input.idempotencyKey, error: "submission_uncertain_reconcile_by_idempotency_key" });
  }
}
