import type { DiscoveredService } from "../../contracts/service.js";
import { LifecycleStateError } from "../../server/errors.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import type { ServiceVariableResolutionOptions } from "../operator/variables.js";
import { BROKER_IDENTITY_LEASE_ENV, issueScopedBrokerIdentity, revokeServiceScopedBrokerIdentities } from "./identity.js";
import {
  compileServiceStartupBrokerPlan,
  mergeServiceVariableResolutionOptions,
  resolveServiceStartupBrokerResolution,
  summarizeRequiredStartupBrokerFailures,
  type BrokerLaunchLookup,
} from "./launch-resolution.js";
import { loadSecretsBrokerRuntimeContext, type SecretsBrokerRuntimeContext } from "./runtime.js";

export interface BrokerMaterializationResolutionOptions {
  workspaceRoot?: string;
  variableResolution?: ServiceVariableResolutionOptions;
  brokerLookup?: BrokerLaunchLookup;
  brokerRuntime?: SecretsBrokerRuntimeContext | null;
}

function parseIdentityLease(environment: Record<string, string> | undefined): unknown | null {
  const raw = environment?.[BROKER_IDENTITY_LEASE_ENV];
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export async function resolveBrokerMaterializationVariables(
  service: DiscoveredService,
  registry: ServiceRegistry,
  options: BrokerMaterializationResolutionOptions = {},
): Promise<ServiceVariableResolutionOptions | undefined> {
  const plan = compileServiceStartupBrokerPlan(service);
  if (plan.brokerRefs.length === 0) return options.variableResolution;

  const brokerRuntime = options.brokerRuntime !== undefined
    ? options.brokerRuntime
    : options.workspaceRoot
      ? await loadSecretsBrokerRuntimeContext(options.workspaceRoot, registry)
      : null;
  const brokerLookup = options.brokerLookup ?? brokerRuntime?.lookup;
  if (!brokerLookup || !brokerRuntime) {
    throw new LifecycleStateError(
      `Cannot materialize service "${service.manifest.id}" because Secrets Broker runtime credentials are unavailable.`,
    );
  }

  revokeServiceScopedBrokerIdentities(service.manifest.id);
  const scopedIdentity = await issueScopedBrokerIdentity(service, {
    launchLeaseIssuer: brokerRuntime.launchLeaseIssuer,
    transportBinding: brokerRuntime.transportBinding,
  });
  const identityLease = parseIdentityLease(scopedIdentity?.env);
  if (!identityLease) {
    revokeServiceScopedBrokerIdentities(service.manifest.id);
    throw new LifecycleStateError(
      `Cannot materialize service "${service.manifest.id}" because a scoped Broker identity was not issued.`,
    );
  }

  try {
    const resolution = await resolveServiceStartupBrokerResolution(
      service,
      brokerLookup,
      options.variableResolution,
      identityLease,
    );
    const failures = summarizeRequiredStartupBrokerFailures(resolution);
    if (failures.length > 0) {
      const refs = failures.map((failure) => `${failure.ref}:${failure.status}`).join(", ");
      throw new LifecycleStateError(
        `Cannot materialize service "${service.manifest.id}" because required Broker refs are unresolved (${refs}).`,
      );
    }
    return mergeServiceVariableResolutionOptions(options.variableResolution, resolution.variableResolution);
  } finally {
    revokeServiceScopedBrokerIdentities(service.manifest.id);
  }
}
