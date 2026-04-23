import net from "node:net";
import type { ServiceHealthResult, TcpHealthcheck } from "./types.js";

export async function checkTcpHealth(healthcheck: TcpHealthcheck): Promise<ServiceHealthResult> {
  const address = healthcheck.address.trim();
  const separator = address.lastIndexOf(":");

  if (separator <= 0 || separator === address.length - 1) {
    return {
      type: "tcp",
      healthy: false,
      detail: `TCP healthcheck address is invalid: ${address}`,
    };
  }

  const host = address.slice(0, separator);
  const port = Number(address.slice(separator + 1));

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      type: "tcp",
      healthy: false,
      detail: `TCP healthcheck port is invalid: ${address}`,
    };
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
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
        detail: `TCP healthcheck connected successfully to ${address}.`,
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
        detail: `TCP healthcheck timed out: ${address}`,
      });
    });
  });
}
