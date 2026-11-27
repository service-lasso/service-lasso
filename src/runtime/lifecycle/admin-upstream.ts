import path from "node:path";
import { isIP } from "node:net";
import { readRuntimeEndpointAllocationPlan, runtimeApiEndpointFromAllocation } from "../ports/allocation.js";

interface AdminUpstreamOptions {
  workspaceRoot?: string;
  runtimeGenerationId?: string | null;
  allocationRevision?: string | null;
}

function samePath(left: string, right: string): boolean {
  const canonical = (value: string) => process.platform === "win32"
    ? path.resolve(value).toLowerCase() : path.resolve(value);
  return canonical(left) === canonical(right);
}

/** Only generation-owned Admin children receive Core's authoritative upstream. */
export async function managedAdminUpstreamEnvironment(
  serviceId: string,
  options: AdminUpstreamOptions,
): Promise<Record<string, string>> {
  if (serviceId !== "@serviceadmin" || !options.runtimeGenerationId) return {};
  const unavailable = () => new Error("managed_admin_upstream_unverified: Cannot verify Service Admin's owning Core endpoint.");
  try {
    if (!options.workspaceRoot) throw unavailable();
    const plan = await readRuntimeEndpointAllocationPlan(options.workspaceRoot);
    if (!plan || plan.phase !== "reserved" || plan.generationId !== options.runtimeGenerationId
      || !samePath(plan.workspaceRoot, options.workspaceRoot)
      || (options.allocationRevision && plan.allocationId !== options.allocationRevision)) throw unavailable();
    const endpoint = runtimeApiEndpointFromAllocation(plan);
    const url = new URL(endpoint.selectors.url);
    if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || !(["localhost", "[::1]"].includes(url.hostname)
        || (isIP(url.hostname) === 4 && url.hostname.startsWith("127.")))) throw unavailable();
    return {
      SERVICE_LASSO_API_BASE_URL: url.origin,
      SERVICE_LASSO_RUNTIME_API_BASE_URL: url.origin,
    };
  } catch {
    // No inherited endpoint, raw filesystem error or alternate-instance fallback.
    throw unavailable();
  }
}
