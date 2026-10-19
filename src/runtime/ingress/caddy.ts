import net from "node:net";
import type { ServiceIngressType, ServiceManifestIngress } from "../../contracts/service.js";

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
  adminAddress: string;
  payload: CaddyRegisterPayload;
}

type FetchLike = typeof fetch;

const registrations = new Map<string, CaddyIngressRegistration>();

// resolveCaddyAdminAddress reads the @caddy admin endpoint from merged
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

export function defaultIngressDomain(serviceId: string): string {
  const slug = serviceId
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-");
  return `${slug}.servicelasso.localhost`;
}

export function buildCaddyRegisterPayload(input: {
  serviceId: string;
  ingress: ServiceManifestIngress;
  target: string;
  ingressPort: number;
}): CaddyRegisterPayload {
  const { serviceId, ingress, target, ingressPort } = input;
  const domain = (ingress.domain?.trim() || defaultIngressDomain(serviceId)).trim();
  const payload: CaddyRegisterPayload = {
    id: serviceId,
    domain,
    ingress_port: ingressPort,
    type: ingress.type,
    target: target.trim(),
  };
  if (ingress.type === "fastcgi") {
    const root = ingress.root?.trim();
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
  fetchImpl: FetchLike,
): Promise<void> {
  const response = await fetchImpl(`http://${adminAddress}${apiPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`caddy admin ${apiPath} returned ${response.status}${detail ? `: ${detail.trim()}` : ""}`);
  }
}

export async function registerCaddyIngress(
  adminAddress: string,
  payload: CaddyRegisterPayload,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await postAdmin(adminAddress, "/service-lasso/register", payload, fetchImpl);
  registrations.set(payload.id, { serviceId: payload.id, adminAddress, payload });
}

export async function unregisterCaddyIngress(
  adminAddress: string,
  id: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await postAdmin(adminAddress, "/service-lasso/unregister", { id }, fetchImpl);
  registrations.delete(id);
}

export function getCaddyIngressRegistration(serviceId: string): CaddyIngressRegistration | undefined {
  return registrations.get(serviceId);
}

export function forgetCaddyIngressRegistration(serviceId: string): void {
  registrations.delete(serviceId);
}

export function resetCaddyIngressRegistrations(): void {
  registrations.clear();
}
