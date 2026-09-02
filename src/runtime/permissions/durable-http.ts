/**
 * Permission policies for leftover HTTP durable mutations (`SPEC-002` `AC-4CD`).
 *
 * Lifecycle install/config/start/stop/restart/reload stay in `lifecycle.ts`
 * (`#1026`). HTTP action-run stays on `#826`. In-process CLI/system actors
 * stay on `AC-4CC`.
 */

export type DurableHttpMutationKind =
  | "update-check"
  | "setup-run"
  | "recovery-doctor"
  | "update-download"
  | "update-install"
  | "runtime-startAll"
  | "runtime-stopAll"
  | "runtime-autostart"
  | "runtime-reload";

export interface DurableHttpMutationPolicy {
  permission:
    | "service:update"
    | "service:configure"
    | "service:diagnose"
    | "service:start"
    | "service:stop"
    | "service:reload";
  sensitive: boolean;
}

const durableHttpMutationPolicies: Record<DurableHttpMutationKind, DurableHttpMutationPolicy> = {
  "update-check": { permission: "service:update", sensitive: false },
  "setup-run": { permission: "service:configure", sensitive: false },
  "recovery-doctor": { permission: "service:diagnose", sensitive: false },
  "update-download": { permission: "service:update", sensitive: false },
  "update-install": { permission: "service:update", sensitive: true },
  "runtime-startAll": { permission: "service:start", sensitive: false },
  "runtime-stopAll": { permission: "service:stop", sensitive: true },
  "runtime-autostart": { permission: "service:start", sensitive: false },
  "runtime-reload": { permission: "service:reload", sensitive: true },
};

/**
 * Returns the catalogue permission and confirmation requirement for one leftover
 * HTTP durable mutation.
 *
 * @param kind Canonical leftover mutation kind.
 */
export function getDurableHttpMutationPolicy(kind: DurableHttpMutationKind): DurableHttpMutationPolicy {
  return durableHttpMutationPolicies[kind];
}

/**
 * Maps runtime orchestration action names onto leftover HTTP permission policy.
 *
 * @param action Runtime action path segment.
 * @returns Policy for startAll/stopAll/autostart/reload, otherwise null.
 */
export function getRuntimeOrchestrationActionPolicy(action: string): DurableHttpMutationPolicy | null {
  if (action === "startAll") {
    return durableHttpMutationPolicies["runtime-startAll"];
  }
  if (action === "stopAll") {
    return durableHttpMutationPolicies["runtime-stopAll"];
  }
  if (action === "autostart") {
    return durableHttpMutationPolicies["runtime-autostart"];
  }
  if (action === "reload") {
    return durableHttpMutationPolicies["runtime-reload"];
  }
  return null;
}
