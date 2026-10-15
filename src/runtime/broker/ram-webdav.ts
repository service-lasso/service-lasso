import path from "node:path";
import { createHash } from "node:crypto";
import type { DiscoveredService } from "../../contracts/service.js";
import type { SecretsBrokerRuntimeContext } from "./runtime.js";
import type { SecretsBrokerLaunchLeaseIssuer } from "./identity.js";
import { issueSecretsBrokerLaunchLease, namespacedBrokerRef } from "./identity.js";

export interface RAMSecretFileGrant { directory: string; revoke: () => Promise<boolean> }
const grants = new Map<string, RAMSecretFileGrant>();
const keyFor = (service: DiscoveredService) => JSON.stringify([service.manifest.id, path.resolve(service.serviceRoot)]);

/** Validate Broker metadata before using a capability in the child environment. */
export function ramSecretFilesDirectory(baseUrl: unknown, token: unknown, platform = process.platform): string {
  if (typeof baseUrl !== "string" || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid RAM provider metadata.");
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/" || Number(url.port) < 1) throw new Error("Invalid RAM provider metadata.");
  // Use forward slashes after the UNC directory as manifest suffixes are portable.
  return platform === "win32" ? `\\\\127.0.0.1@${url.port}\\DavWWWRoot\\${token}` : `${url.origin}/${token}`;
}

export async function createRAMSecretFileGrant(
  service: DiscoveredService,
  runtime: SecretsBrokerRuntimeContext | null | undefined,
  issuer: SecretsBrokerLaunchLeaseIssuer | undefined,
  outputs: Array<{ path: string; content: string }>,
): Promise<RAMSecretFileGrant> {
  if (!runtime?.operatorRequest) throw new Error("Broker RAM provider unavailable.");
  // Capability paths must never become a persisted executable command or globals.
  const { env: _env, config: _config, ...otherManifest } = service.manifest;
  if (JSON.stringify(otherManifest).includes("SERVICE_LASSO_SECRETS_DIR")) throw new Error("Secret-file paths belong in the service environment.");
  const identityLease = await issueSecretsBrokerLaunchLease(service, {
    launchLeaseIssuer: issuer, transportBinding: runtime.transportBinding,
  });
  if (!identityLease) throw new Error("Broker file-grant identity unavailable.");
  const result = await runtime.operatorRequest({ method: "POST", pathWithQuery: "/v1/file-grants",
    headers: { "Content-Type": "application/json" }, body: Buffer.from(JSON.stringify({
      serviceId: service.manifest.id, workspaceId: issuer?.workspaceId, identityLease,
      instanceId: createHash("sha256").update(keyFor(service)).digest("hex"), files: outputs,
      bindings: (service.manifest.broker?.imports ?? []).map((entry) => ({
        selector: entry.ref, ref: namespacedBrokerRef(entry.namespace, entry.ref), required: entry.required === true,
      })),
    })),
  });
  if (result.status !== 201) throw new Error("Broker file grant rejected.");
  const response = JSON.parse(result.body.toString("utf8")) as { baseUrl?: unknown; token?: unknown; directory?: unknown };
  // Revocation is exact-token and cannot remove a replacement generation.
  const token = response.token;
  const httpDirectory = ramSecretFilesDirectory(response.baseUrl, token, "linux");
  if (response.directory !== httpDirectory) throw new Error("Invalid Broker secret-file directory.");
  const directory = ramSecretFilesDirectory(response.baseUrl, token);
  const key = keyFor(service);
  const grant: RAMSecretFileGrant = { directory, revoke: async () => {
    try {
      const revoked = await runtime.operatorRequest({ method: "POST", pathWithQuery: "/v1/file-grants/revoke",
        headers: { "Content-Type": "application/json" }, body: Buffer.from(JSON.stringify({ token })),
      });
      if (revoked.status !== 204) return false;
      if (grants.get(key) === grant) grants.delete(key);
      return true;
    } catch { return false; } // Retain the in-memory grant for a retry; process stop still completes.
  } };
  grants.set(key, grant);
  return grant;
}

export async function revokeRAMSecretFileGrant(service: DiscoveredService): Promise<boolean> {
  return await grants.get(keyFor(service))?.revoke() ?? true;
}
