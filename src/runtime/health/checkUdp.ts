import dgram from "node:dgram";
import type { ServiceHealthResult, UdpHealthcheck } from "./types.js";

const DEFAULT_UDP_HEALTHCHECK_TIMEOUT_MS = 2_000;

export async function checkUdpHealth(healthcheck: UdpHealthcheck): Promise<ServiceHealthResult> {
  const target =
    healthcheck.address !== undefined
      ? parseUdpAddress(healthcheck.address)
      : parseUdpHostPort(healthcheck.host, healthcheck.port);

  if (!target) {
    return {
      type: "udp",
      healthy: false,
      detail: "UDP healthcheck target is invalid; expected address or host + port.",
    };
  }

  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    return {
      type: "udp",
      healthy: false,
      detail: `UDP healthcheck port is invalid: ${target.address}`,
    };
  }

  const timeoutMs = healthcheck.timeout ?? DEFAULT_UDP_HEALTHCHECK_TIMEOUT_MS;
  const socket = dgram.createSocket("udp4");

  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish({
        type: "udp",
        healthy: false,
        detail: `UDP healthcheck timed out after ${timeoutMs}ms: ${target.address}`,
      });
    }, timeoutMs);

    function finish(payload: ServiceHealthResult) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      socket.close();
      resolve(payload);
    }

    socket.once("error", (error) => {
      finish({
        type: "udp",
        healthy: false,
        detail: `UDP healthcheck failed: ${error.message}`,
      });
    });

    socket.on("message", (message) => {
      const response = message.toString("utf8");
      finish({
        type: "udp",
        healthy: response === healthcheck.expect,
        detail:
          response === healthcheck.expect
            ? `UDP healthcheck received expected response from ${target.address}.`
            : `UDP healthcheck received "${response}", expected "${healthcheck.expect}".`,
      });
    });

    socket.send(Buffer.from(healthcheck.send), target.port, target.host, (error) => {
      if (error) {
        finish({
          type: "udp",
          healthy: false,
          detail: `UDP healthcheck failed: ${error.message}`,
        });
      }
    });
  });
}

function parseUdpAddress(address: string): { host: string; port: number; address: string } | undefined {
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

function parseUdpHostPort(
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
