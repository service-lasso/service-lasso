import http from "node:http";
import net from "node:net";
import type { ServiceIngress, ServiceIngressType } from "../../contracts/service.js";

export interface CaddyRegisterPayload {
  id: string;
  domain: string;
  ingress_port: number;
  type: ServiceIngressType;
  target: string;
  root?: string;
}

export interface CaddyIngressRegistration {
  serviceId: string;
  routeId: string;
  adminAddress: string;
  payload: CaddyRegisterPayload;
}

// Admin requests use node:http so Caddy's admin origin checks do not see
// browser-style fetch headers.

// Keyed by route id so a service can own more than one ingress route.
const registrations = new Map<string, CaddyIngressRegistration>();

// resolveCaddyAdminAddress reads the shared @caddy admin endpoint from merged
// globalenv. `CADDY_ADMIN_ADDR` is preferred; otherwise host+port are combined.
export function resolveCaddyAdminAddress(globalEnv: Record<string, string | undefined>): string | null {
  const direct = globalEnv.CADDY_ADMIN_ADDR?.trim();
  if (direct) {
    return direct;
  }
  const port = globalEnv.CADDY_ADMIN_PORT?.trim();
  if (!port) {
    return null;
  }
  const host = globalEnv.CADDY_ADMIN_BIND?.trim() || "127.0.0.1";
  return `${host}:${port}`;
}

// resolveCaddyIngressPort returns the shared @caddy listener port. Every service
// registers into the same instance/listener, so this must be stable across all
// registrations rather than a per-service allocated port.
export function resolveCaddyIngressPort(globalEnv: Record<string, string | undefined>): number | null {
  const raw = globalEnv.CADDY_HTTP_PORT?.trim();
  if (!raw) {
    return null;
  }
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

export function defaultIngressDomain(serviceId: string): string {
  const slug = serviceId
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-");
  return `${slug}.servicelasso.localhost`;
}

export function buildCaddyRegisterPayload(input: {
  serviceId: string;
  ingress: ServiceIngress;
  target: string;
  ingressPort: number;
  routeId?: string;
}): CaddyRegisterPayload {
  const { serviceId, ingress, target, ingressPort, routeId } = input;
  const proxy = ingress.proxy;
  const domain = (ingress.domain?.trim() || defaultIngressDomain(serviceId)).trim();
  const payload: CaddyRegisterPayload = {
    id: routeId ?? serviceId,
    domain,
    ingress_port: ingressPort,
    type: proxy.type,
    target: target.trim(),
  };
  if (proxy.type === "fastcgi") {
    const root = proxy.root?.trim();
    if (!root) {
      throw new Error(`fastcgi ingress for "${serviceId}" requires "root".`);
    }
    payload.root = root;
  }
  if (!payload.target) {
    throw new Error(`ingress for "${serviceId}" requires a non-empty target.`);
  }
  if (!Number.isInteger(ingressPort) || ingressPort <= 0 || ingressPort > 65535) {
    throw new Error(`ingress for "${serviceId}" requires a valid ingress port, got ${ingressPort}.`);
  }
  return payload;
}

export async function reserveIngressPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve an ingress port.")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function postAdmin(
  adminAddress: string,
  apiPath: string,
  body: unknown,
): Promise<void> {
  const [hostname, portText] = adminAddress.split(":");
  const port = Number(portText);
  const payload = JSON.stringify(body);

  await new Promise<void>((resolve, reject) => {
    const request = http.request(
      {
        hostname,
        port,
        method: "POST",
        path: apiPath,
        agent: false,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let detail = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (detail += chunk));
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve();
            return;
          }
          reject(new Error(`caddy admin ${apiPath} returned ${status}${detail ? `: ${detail.trim()}` : ""}`));
        });
      },
    );
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

export async function registerCaddyIngress(
  adminAddress: string,
  payload: CaddyRegisterPayload,
  serviceId: string = payload.id,
): Promise<void> {
  await postAdmin(adminAddress, "/service-lasso/register", payload);
  registrations.set(payload.id, {
    serviceId,
    routeId: payload.id,
    adminAddress,
    payload,
  });
}

export async function unregisterCaddyIngress(
  adminAddress: string,
  id: string,
): Promise<void> {
  await postAdmin(adminAddress, "/service-lasso/unregister", { id });
  registrations.delete(id);
}

export function listCaddyIngressRegistrations(serviceId: string): CaddyIngressRegistration[] {
  return [...registrations.values()].filter((registration) => registration.serviceId === serviceId);
}

export function getCaddyIngressRegistration(serviceId: string): CaddyIngressRegistration | undefined {
  return listCaddyIngressRegistrations(serviceId)[0];
}

export function forgetCaddyIngressRegistration(serviceId: string): void {
  for (const [routeId, registration] of registrations) {
    if (registration.serviceId === serviceId) {
      registrations.delete(routeId);
    }
  }
}

export function resetCaddyIngressRegistrations(): void {
  registrations.clear();
}
