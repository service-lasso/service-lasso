import { isLoopbackAddress } from "./request-policy.js";
import {
  LOCAL_OPERATOR_USERNAME,
  REMOTE_LOGIN_MAX_FAILURES,
  REMOTE_LOGIN_WINDOW_MS,
} from "./local-auth-constants.js";
import {
  issueLocalAuthSession,
  type LocalAuthMaterial,
} from "./local-auth-store.js";

export type LocalAuthMethod = "token" | "password";

export interface LocalAuthValidateInput {
  method: LocalAuthMethod;
  token?: string;
  username?: string;
  password?: string;
}

export type LocalAuthValidateResult =
  | { ok: true; sessionToken: string }
  | { ok: false; error: string; statusCode: number };

interface RemoteAttemptWindow {
  failures: number;
  windowStartedAt: number;
}

const remoteAttempts = new Map<string, RemoteAttemptWindow>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a local-auth login body. Never returns credential values in errors.
 */
export function parseLocalAuthValidateInput(body: unknown): LocalAuthValidateInput | string {
  if (!isRecord(body) || (body.method !== "token" && body.method !== "password")) {
    return "Request body must include method \"token\" or \"password\".";
  }
  if (body.method === "token") {
    if (typeof body.token !== "string" || body.token.trim().length === 0) {
      return "Token login requires a non-empty token.";
    }
    return { method: "token", token: body.token };
  }
  if (typeof body.username !== "string" || body.username.trim() !== LOCAL_OPERATOR_USERNAME) {
    return "Password login requires username local-operator.";
  }
  if (typeof body.password !== "string" || body.password.length === 0) {
    return "Password login requires a Lasso-local operator password.";
  }
  return { method: "password", username: LOCAL_OPERATOR_USERNAME, password: body.password };
}

function attemptKey(clientAddress: string | null): string {
  return clientAddress?.trim() || "unknown";
}

/**
 * Remote-only failure limiter. Loopback is never locked by this map.
 */
export function consumeRemoteLoginAttempt(clientAddress: string | null): boolean {
  if (isLoopbackAddress(clientAddress)) {
    return true;
  }
  const key = attemptKey(clientAddress);
  const now = Date.now();
  const current = remoteAttempts.get(key);
  if (!current || now - current.windowStartedAt > REMOTE_LOGIN_WINDOW_MS) {
    remoteAttempts.set(key, { failures: 0, windowStartedAt: now });
    return true;
  }
  return current.failures < REMOTE_LOGIN_MAX_FAILURES;
}

export function recordRemoteLoginFailure(clientAddress: string | null): void {
  if (isLoopbackAddress(clientAddress)) {
    return;
  }
  const key = attemptKey(clientAddress);
  const now = Date.now();
  const current = remoteAttempts.get(key);
  if (!current || now - current.windowStartedAt > REMOTE_LOGIN_WINDOW_MS) {
    remoteAttempts.set(key, { failures: 1, windowStartedAt: now });
    return;
  }
  current.failures += 1;
}

export function resetRemoteLoginFailures(clientAddress: string | null): void {
  remoteAttempts.delete(attemptKey(clientAddress));
}

export function clearRemoteLoginAttempts(): void {
  remoteAttempts.clear();
}

/**
 * Validate a local-operator token or Lasso-local password and issue a session.
 * Does not accept OS account passwords. Does not log secrets.
 */
export function validateLocalAuth(
  input: LocalAuthValidateInput,
  material: LocalAuthMaterial,
  options: { clientAddress: string | null; forceSso: boolean; local: boolean },
): LocalAuthValidateResult {
  if (!options.local && options.forceSso) {
    return {
      ok: false,
      error: "force_sso_required",
      statusCode: 401,
    };
  }
  if (!consumeRemoteLoginAttempt(options.clientAddress)) {
    return {
      ok: false,
      error: "local_auth_rate_limited",
      statusCode: 429,
    };
  }

  const accepted =
    input.method === "token"
      ? Boolean(input.token && material.verifyLocalSecret(input.token))
      : Boolean(input.password && material.verifyPassword(input.password));

  if (!accepted) {
    recordRemoteLoginFailure(options.clientAddress);
    return {
      ok: false,
      error: "local_auth_rejected",
      statusCode: 401,
    };
  }

  resetRemoteLoginFailures(options.clientAddress);
  return {
    ok: true,
    sessionToken: issueLocalAuthSession(),
  };
}
