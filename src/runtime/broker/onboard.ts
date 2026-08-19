import type { DiscoveredService } from "../../contracts/service.js";
import {
  issueSecretsBrokerLaunchLease,
  namespacedBrokerRef,
  type SecretsBrokerLaunchLeaseIssuer,
} from "./identity.js";
import {
  compileServiceStartupBrokerPlan,
  type ServiceStartupBrokerGeneratedSecretPlan,
  type ServiceStartupBrokerResolution,
} from "./launch-resolution.js";
import {
  readSecretsBrokerOperatorConfig,
  resolveSecretsBrokerPort,
} from "./operator-config.js";

const DEFAULT_WORKSPACE_ID = "local-demo";

export interface ProducerOnboardResult {
  appliedRefs: string[];
  skippedRefs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lengthClassForBytes(bytes: number): "16_bytes" | "32_bytes" | "64_bytes" | "policy_default" {
  if (bytes === 16) {
    return "16_bytes";
  }
  if (bytes === 32) {
    return "32_bytes";
  }
  if (bytes === 64) {
    return "64_bytes";
  }
  return "policy_default";
}

function policyKindForSecret(kind: ServiceStartupBrokerGeneratedSecretPlan["valuePolicy"]["kind"]): string {
  if (kind === "session-secret") {
    return "session-signing-key";
  }
  return "opaque";
}

function namespacedProducerRef(entry: ServiceStartupBrokerGeneratedSecretPlan): string | null {
  if (!entry.namespace) {
    return null;
  }
  return namespacedBrokerRef(entry.namespace, entry.ref);
}

function lookupStatusForRef(
  resolution: ServiceStartupBrokerResolution,
  ref: string,
): ServiceStartupBrokerResolution["decisions"][number]["status"] | "missing" {
  const match = resolution.decisions.find((decision) => decision.ref === ref);
  return match?.status ?? "missing";
}

/**
 * First-run onboard for missing declared Broker-generated producer secrets.
 *
 * Discovery must not call this. Default is no overwrite: a ref that already
 * resolves is skipped. Apply responses are metadata-only and must not be logged
 * with secret values.
 *
 * @param options Service plus the current launch resolution and local Broker
 */
export async function onboardMissingProducerSecrets(options: {
  service: DiscoveredService;
  resolution: ServiceStartupBrokerResolution;
  brokerService: DiscoveredService;
  launchLeaseIssuer?: SecretsBrokerLaunchLeaseIssuer;
}): Promise<ProducerOnboardResult> {
  const appliedRefs: string[] = [];
  const skippedRefs: string[] = [];
  const plan = compileServiceStartupBrokerPlan(options.service);
  const producers = plan.writeback.generatedSecrets.filter(
    (entry) => entry.generationMode === "broker_generated" && (entry.operation === "create" || entry.operation === "rotate"),
  );
  if (producers.length === 0) {
    return { appliedRefs, skippedRefs };
  }

  const operatorConfig = await readSecretsBrokerOperatorConfig(options.brokerService.serviceRoot);
  const port = resolveSecretsBrokerPort(options.brokerService);
  if (!operatorConfig || port === null) {
    return { appliedRefs, skippedRefs };
  }

  const identityLease = await issueSecretsBrokerLaunchLease(options.service, {
    launchLeaseIssuer: options.launchLeaseIssuer,
    transportBinding: null,
  });
  if (!identityLease) {
    return { appliedRefs, skippedRefs };
  }

  for (const entry of producers) {
    if (entry.operation !== "create") {
      skippedRefs.push(entry.ref);
      continue;
    }

    const status = lookupStatusForRef(options.resolution, entry.ref);
    if (status !== "missing") {
      skippedRefs.push(entry.ref);
      continue;
    }

    const namespacedRef = namespacedProducerRef(entry);
    if (!namespacedRef || !entry.namespace) {
      skippedRefs.push(entry.ref);
      continue;
    }

    const requestBody = {
      requestId: `service-lasso-onboard-${options.service.manifest.id}-${entry.ref}`,
      workspaceId: options.launchLeaseIssuer?.workspaceId?.trim() || DEFAULT_WORKSPACE_ID,
      serviceId: options.service.manifest.id,
      ref: namespacedRef,
      operation: "create",
      generationMode: "broker_generated",
      reason: entry.auditReason ?? "first-run producer secret onboard",
      confirm: true,
      identity: {
        serviceId: options.service.manifest.id,
      },
      identityLease,
      policy: {
        allowedNamespaces: [...plan.writeback.allowedNamespaces],
        allowedOperations: [...plan.writeback.allowedOperations],
      },
      generatedValuePolicy: {
        kind: policyKindForSecret(entry.valuePolicy.kind),
        lengthClass: lengthClassForBytes(entry.valuePolicy.bytes),
        entropyClass: "cryptographic",
        rotationPolicy: "first_run_then_operator_rotation",
      },
    };

    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/provisioning/operations/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${operatorConfig.apiToken}`,
        },
        body: JSON.stringify(requestBody),
      });
      const payload: unknown = await response.json();
      const record = isRecord(payload) ? payload : {};
      if (response.ok && (record.applied === true || record.outcome === "applied")) {
        appliedRefs.push(entry.ref);
        continue;
      }
      skippedRefs.push(entry.ref);
    } catch {
      skippedRefs.push(entry.ref);
    }
  }

  return { appliedRefs, skippedRefs };
}
