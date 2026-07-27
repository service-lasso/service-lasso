import net from "node:net";
import type { ServiceHealthResult, TcpHealthcheck } from "./types.js";

export async function checkTcpHealth(healthcheck: TcpHealthcheck): Promise<ServiceHealthResult> {
  const target =
    healthcheck.address !== undefined
      ? parseTcpAddress(healthcheck.address)
      : parseTcpHostPort(healthcheck.host, healthcheck.port);

  if (!target) {
    return {
      type: "tcp",
      healthy: false,
      detail: "TCP healthcheck target is invalid; expected address or host + port.",
    };
  }

  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    return {
      type: "tcp",
      healthy: false,
      detail: `TCP healthcheck port is invalid: ${target.address}`,
    };
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: target.host, port: target.port });
    let settled = false;

    const finish = (payload: ServiceHealthResult) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(payload);
    };

    socket.once("connect", () => {
      socket.end();
      finish({
        type: "tcp",
        healthy: true,
        detail: `TCP healthcheck connected successfully to ${target.address}.`,
      });
    });

    socket.once("error", (error: Error) => {
      socket.destroy();
      finish({
        type: "tcp",
        healthy: false,
        detail: `TCP healthcheck failed: ${error.message}`,
      });
    });

    socket.setTimeout(2_000, () => {
      socket.destroy();
      finish({
        type: "tcp",
        healthy: false,
        detail: `TCP healthcheck timed out: ${target.address}`,
      });
    });
  });
}

function parseTcpAddress(address: string): { host: string; port: number; address: string } | undefined {
  const resolvedAddress = address.trim();
  const separator = resolvedAddress.lastIndexOf(":");

  if (separator <= 0 || separator === resolvedAddress.length - 1) {
    return undefined;
  }

  const host = resolvedAddress.slice(0, separator).trim();
  const port = Number(resolvedAddress.slice(separator + 1).trim());
  if (!host) {
    return undefined;
  }

  return {
    host,
    port,
    address: `${host}:${Number.isFinite(port) ? port : resolvedAddress.slice(separator + 1).trim()}`,
  };
}

function parseTcpHostPort(
  host: string | undefined,
  port: string | number | undefined,
): { host: string; port: number; address: string } | undefined {
  const resolvedHost = host?.trim();
  const resolvedPort = typeof port === "number" ? port : Number(port?.trim());

  if (!resolvedHost) {
    return undefined;
  }

  return {
    host: resolvedHost,
    port: resolvedPort,
    address: `${resolvedHost}:${Number.isFinite(resolvedPort) ? resolvedPort : String(port ?? "").trim()}`,
  };
}
