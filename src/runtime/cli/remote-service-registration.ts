/**
 * External CLI transport for Core's remote released-service registration
 * contract (`SPEC-006` AC-6C/AC-6E).  This module has no local service-root
 * access: Core remains the authority for identity, release allowlisting,
 * permissions, confirmation, durable state, and audit.
 */

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

export const CLI_LOCAL_ADMIN_TOKEN_ENV = "SERVICE_LASSO_CLI_LOCAL_ADMIN_TOKEN";

export interface RemoteServiceRegistrationOperation {
  id: string;
  kind: "service_registration";
  status: "completed" | "conflict" | "unknown";
  replayed: boolean;
  actorId: string;
  repo: string;
  tag: string;
  sourceCommit: string;
  serviceId: string;
  version: string | null;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
}

export interface RemoteServiceRegistrationCliOptions {
  apiBaseUrl: string;
  repo: string;
  tag: string;
  expectedCommit: string;
  expectedManifestSha256: string;
  idempotencyKey: string;
}

export type RemoteServiceRegistrationCliResult =
  | { action: "register"; ok: true; statusCode: 200 | 201 | 409; operation: RemoteServiceRegistrationOperation }
  | { action: "operation"; ok: true; statusCode: 200; operation: RemoteServiceRegistrationOperation }
  | { action: "register" | "operation"; ok: false; statusCode: number | null; error: string };

function requireCredential(): string {
  const token = process.env[CLI_LOCAL_ADMIN_TOKEN_ENV]?.trim();
  if (!token) {
    throw new Error(`${CLI_LOCAL_ADMIN_TOKEN_ENV} must be set; credentials are never accepted as CLI arguments.`);
  }
  return token;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function parseApiBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--api-base-url must be an absolute HTTP(S) URL.");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("--api-base-url must not contain credentials or a fragment.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new Error("--api-base-url must use HTTPS unless its host is loopback.");
  }
  return url;
}

function apiUrl(base: URL, route: string): string {
  const url = new URL(base.toString());
  url.pathname = `${url.pathname.replace(/\/$/, "")}${route}`;
  url.search = "";
  return url.toString();
}

function assertRegistrationOptions(options: RemoteServiceRegistrationCliOptions): void {
  parseApiBaseUrl(options.apiBaseUrl);
  if (!REPO_PATTERN.test(options.repo)) throw new Error("--repo must be an owner/repository release reference.");
  if (!TAG_PATTERN.test(options.tag)) throw new Error("--tag must be a release tag.");
  if (!COMMIT_PATTERN.test(options.expectedCommit)) throw new Error("--expected-commit must be a lowercase 40-character commit SHA.");
  if (!SHA256_PATTERN.test(options.expectedManifestSha256)) throw new Error("--expected-manifest-sha256 must be a lowercase SHA-256 digest.");
  if (!IDEMPOTENCY_KEY_PATTERN.test(options.idempotencyKey)) throw new Error("--idempotency-key must be an opaque 8-128 character key.");
}

function parseSafeError(response: Response): Promise<string> {
  return response.json()
    .then((body: unknown) => {
      if (body && typeof body === "object" && !Array.isArray(body) && typeof (body as { error?: unknown }).error === "string") {
        return (body as { error: string }).error;
      }
      return "remote_request_failed";
    })
    .catch(() => "remote_request_failed");
}

function isOperation(value: unknown): value is RemoteServiceRegistrationOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const operation = value as Partial<RemoteServiceRegistrationOperation>;
  return typeof operation.id === "string" && operation.kind === "service_registration" &&
    (operation.status === "completed" || operation.status === "conflict" || operation.status === "unknown") &&
    typeof operation.replayed === "boolean" && typeof operation.actorId === "string" &&
    typeof operation.repo === "string" && typeof operation.tag === "string" &&
    typeof operation.sourceCommit === "string" && typeof operation.serviceId === "string" &&
    (typeof operation.version === "string" || operation.version === null) && typeof operation.createdAt === "string" &&
    (typeof operation.completedAt === "string" || operation.completedAt === null) &&
    (typeof operation.errorCode === "string" || operation.errorCode === null);
}

async function requestOperation(input: { action: "register" | "operation"; url: string; init: RequestInit }): Promise<RemoteServiceRegistrationCliResult> {
  let response: Response;
  try {
    response = await fetch(input.url, input.init);
  } catch {
    return { action: input.action, ok: false, statusCode: null, error: "remote_request_unavailable" };
  }
  // The Core registration contract deliberately returns a durable conflict
  // operation with HTTP 409. It is a safe terminal outcome, not a transport
  // error; all other non-success responses remain typed failures.
  if (!response.ok && !(input.action === "register" && response.status === 409)) {
    return { action: input.action, ok: false, statusCode: response.status, error: await parseSafeError(response) };
  }
  let body: unknown;
  try { body = await response.json(); } catch { return { action: input.action, ok: false, statusCode: response.status, error: "invalid_remote_response" }; }
  const operation = body && typeof body === "object" && !Array.isArray(body) ? (body as { operation?: unknown }).operation : undefined;
  if (!isOperation(operation)) return { action: input.action, ok: false, statusCode: response.status, error: "invalid_remote_response" };
  if (input.action === "register" && response.status !== 200 && response.status !== 201 && response.status !== 409) {
    return { action: input.action, ok: false, statusCode: response.status, error: "invalid_remote_response" };
  }
  return input.action === "register"
    ? { action: "register", ok: true, statusCode: response.status as 200 | 201 | 409, operation }
    : { action: "operation", ok: true, statusCode: 200, operation };
}

export async function registerReleasedServiceFromCli(options: RemoteServiceRegistrationCliOptions): Promise<RemoteServiceRegistrationCliResult> {
  assertRegistrationOptions(options);
  const token = requireCredential();
  const base = parseApiBaseUrl(options.apiBaseUrl);
  return requestOperation({
    action: "register",
    url: apiUrl(base, "/api/runtime/actions/importService"),
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-lasso-admin-token": token },
      body: JSON.stringify({
        repo: options.repo,
        tag: options.tag,
        expectedCommit: options.expectedCommit,
        expectedManifestSha256: options.expectedManifestSha256,
        idempotencyKey: options.idempotencyKey,
        confirm: true,
      }),
    },
  });
}

export async function readReleasedServiceRegistrationOperationFromCli(options: { apiBaseUrl: string; operationId: string }): Promise<RemoteServiceRegistrationCliResult> {
  const base = parseApiBaseUrl(options.apiBaseUrl);
  if (!/^sro_[a-f0-9]{32}$/.test(options.operationId)) throw new Error("<operationId> must be a service registration operation id.");
  const token = requireCredential();
  return requestOperation({
    action: "operation",
    url: apiUrl(base, `/api/operator/operations/${encodeURIComponent(options.operationId)}`),
    init: { headers: { "x-service-lasso-admin-token": token } },
  });
}
