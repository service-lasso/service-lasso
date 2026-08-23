import http from "node:http";
import { ApiError } from "../../server/errors.js";

/** Durable Broker mutations get a 30-second IPC window; lookups stay inside the same bound. */
export const SECRETSBROKER_IPC_TIMEOUT_MS = 30_000;

/** Request and response bodies larger than 1 MiB fail closed before Broker sees or returns them. */
export const SECRETSBROKER_IPC_MAX_BYTES = 1_048_576;

const WINDOWS_PIPE_PREFIXES = ["\\\\.\\pipe\\", "//./pipe/"];

/** OS transport Core uses to reach the local Secrets Broker HTTP API. */
export type SecretsBrokerTransportKind = "loopback-http" | "unix-socket" | "windows-named-pipe";

/**
 * Loopback TCP or OS IPC target. Socket paths must never be logged, audited, or
 * copied into API error messages.
 */
export type SecretsBrokerTransportTarget =
  | { kind: "loopback-http"; port: number }
  | { kind: "unix-socket"; socketPath: string }
  | { kind: "windows-named-pipe"; socketPath: string };

/** Bounded HTTP result from a Broker transport. Headers stay hop-by-hop filtered by the caller. */
export interface SecretsBrokerHttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface SecretsBrokerHttpRequest {
  method: string;
  pathWithQuery: string;
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs?: number;
}

/**
 * True when the value is a non-array object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a Windows named-pipe path without interpolating it into messages.
 */
export function isWindowsNamedPipePath(socketPath: string): boolean {
  for (const prefix of WINDOWS_PIPE_PREFIXES) {
    if (socketPath.startsWith(prefix) && socketPath.length > prefix.length) {
      return true;
    }
  }
  return false;
}

/**
 * Validate a Unix-socket path as an absolute filesystem path.
 */
export function isUnixSocketPath(socketPath: string): boolean {
  return socketPath.startsWith("/") && !socketPath.includes("\0") && socketPath.length > 1;
}

/**
 * Parse optional operator.json ipc metadata. Invalid shapes are ignored so a
 * corrupt ipc block cannot disable loopback fallback.
 */
export function parseSecretsBrokerOperatorIpc(value: unknown):
  | { kind: "loopback-http" }
  | { kind: "unix-socket"; socketPath: string }
  | { kind: "windows-named-pipe"; socketPath: string }
  | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }

  if (value.kind === "loopback-http") {
    return { kind: "loopback-http" };
  }

  if (typeof value.socketPath !== "string") {
    return undefined;
  }

  const socketPath = value.socketPath.trim();
  if (value.kind === "windows-named-pipe" && isWindowsNamedPipePath(socketPath)) {
    return { kind: "windows-named-pipe", socketPath };
  }
  if (value.kind === "unix-socket" && isUnixSocketPath(socketPath)) {
    return { kind: "unix-socket", socketPath };
  }
  return undefined;
}

/**
 * Fail closed with a path-free Broker unavailable error.
 */
function unavailable(): ApiError {
  return new ApiError("broker_unavailable", 503, "Secrets Broker transport is unavailable.");
}

/**
 * Issue one HTTP/1.1 request over loopback TCP, a Unix socket, or a Windows named pipe.
 * Timeouts, oversized bodies, and transport failures stay typed and omit IPC paths.
 */
export async function requestSecretsBrokerHttp(
  target: SecretsBrokerTransportTarget,
  request: SecretsBrokerHttpRequest,
): Promise<SecretsBrokerHttpResponse> {
  const method = request.method.toUpperCase();
  const body = request.body;
  if (body && body.byteLength > SECRETSBROKER_IPC_MAX_BYTES) {
    throw new ApiError("payload_too_large", 413, "Secrets Broker request exceeds the size limit.");
  }

  const timeoutMs = request.timeoutMs ?? SECRETSBROKER_IPC_TIMEOUT_MS;
  const pathWithQuery = request.pathWithQuery.startsWith("/")
    ? request.pathWithQuery
    : `/${request.pathWithQuery}`;

  const options: http.RequestOptions = {
    method,
    path: pathWithQuery,
    headers: {
      ...request.headers,
      host: "127.0.0.1",
    },
    timeout: timeoutMs,
  };

  if (target.kind === "loopback-http") {
    options.hostname = "127.0.0.1";
    options.port = target.port;
  } else {
    options.socketPath = target.socketPath;
  }

  return await new Promise<SecretsBrokerHttpResponse>((resolve, reject) => {
    let settled = false;
    const succeed = (value: SecretsBrokerHttpResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const upstream = http.request(options, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.byteLength;
        if (total > SECRETSBROKER_IPC_MAX_BYTES) {
          upstream.destroy();
          fail(new ApiError("payload_too_large", 502, "Secrets Broker response exceeds the size limit."));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        succeed({
          status: response.statusCode ?? 502,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
      response.on("error", () => {
        fail(unavailable());
      });
    });

    upstream.on("timeout", () => {
      upstream.destroy();
      fail(new ApiError("broker_timeout", 504, "Secrets Broker transport timed out."));
    });
    upstream.on("error", () => {
      fail(unavailable());
    });

    if (body && body.byteLength > 0 && method !== "GET" && method !== "HEAD") {
      upstream.end(body);
      return;
    }
    upstream.end();
  });
}
