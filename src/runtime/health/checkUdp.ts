import dgram from "node:dgram";
import type { ServiceHealthResult, UdpHealthcheck } from "./types.js";

const DEFAULT_UDP_TIMEOUT_MS = 2_000;

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

  const payload = Buffer.from(healthcheck.send, "utf8");
  const expected = Buffer.from(healthcheck.expect, "utf8");
  const timeoutMs = healthcheck.timeout ?? DEFAULT_UDP_TIMEOUT_MS;

  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (payload: ServiceHealthResult) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      socket.close();
      resolve(payload);
    };

    socket.once("error", (error: Error) => {
      finish({
        type: "udp",
        healthy: false,
        detail: `UDP healthcheck failed: ${error.message}`,
      });
    });

    socket.once("message", (message) => {
      if (message.equals(expected)) {
        finish({
          type: "udp",
          healthy: true,
          detail: `UDP healthcheck response matched expected payload from ${target.address}.`,
        });
        return;
      }

      finish({
        type: "udp",
        healthy: false,
        detail: `UDP healthcheck response did not match expected payload from ${target.address}.`,
      });
    });

    timer = setTimeout(() => {
      finish({
        type: "udp",
        healthy: false,
        detail: `UDP healthcheck timed out waiting for expected response from ${target.address}.`,
      });
    }, timeoutMs);

    socket.send(payload, target.port, target.host, (error) => {
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
