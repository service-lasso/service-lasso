import type { DiscoveredService } from "../../contracts/service.js";
import {
  issueSecretsBrokerLaunchLease,
  namespacedBrokerRef,
  type SecretsBrokerLaunchLeaseIssuer,
} from "./identity.js";
import {
  type BrokerLaunchLookup,
  type BrokerLaunchLookupDecision,
  type BrokerLaunchLookupStatus,
} from "./launch-resolution.js";
import {
  buildSecretsBrokerRuntimeEnv,
  LAUNCH_LEASE_ARGS_ENV,
  LAUNCH_LEASE_COMMAND_ENV,
  mergeSecretsBrokerOperatorEnv,
  readSecretsBrokerOperatorConfig,
  resolveSecretsBrokerCli,
  resolveSecretsBrokerDataPaths,
  resolveSecretsBrokerPort,
  WORKSPACE_ID_ENV,
} from "./operator-config.js";

const DEFAULT_WORKSPACE_ID = "local-demo";

interface BrokerResolveResultItem {
  ref: string;
  outcome: string;
  value?: string;
}

function parseConfiguredLaunchLeaseArgs(env: NodeJS.ProcessEnv): string[] {
  const raw = env[LAUNCH_LEASE_ARGS_ENV]?.trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapResolveOutcome(outcome: string): BrokerLaunchLookupStatus {
  switch (outcome) {
    case "ready":
      return "resolved";
    case "missing_ref":
    case "not_found":
      return "missing";
    case "locked":
      return "locked";
    case "policy_denied":
      return "policy-denied";
    case "source_auth_required":
      return "auth-required";
    case "source_unavailable":
    case "identity_invalid":
    case "identity_expired":
    case "identity_replayed":
      return outcome.startsWith("identity_") ? "auth-required" : "source-unavailable";
    case "degraded":
      return "degraded";
    default:
      return "missing";
  }
}

function unavailableDecisions(refs: string[], status: BrokerLaunchLookupStatus): BrokerLaunchLookupDecision[] {
  return refs.map((ref) => ({ ref, status }));
}

function parseResolveResults(payload: unknown): BrokerResolveResultItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return [];
  }

  const results: BrokerResolveResultItem[] = [];
  for (const entry of payload.results) {
    if (!isRecord(entry) || typeof entry.ref !== "string" || typeof entry.outcome !== "string") {
      continue;
    }
    results.push({
      ref: entry.ref,
      outcome: entry.outcome,
      value: typeof entry.value === "string" ? entry.value : undefined,
    });
  }
  return results;
}

function namespacedRefForService(service: DiscoveredService, ref: string): string {
  const imported = (service.manifest.broker?.imports ?? []).find((entry) => entry.ref === ref);
  if (imported) {
    return namespacedBrokerRef(imported.namespace, imported.ref);
  }
  return ref;
}

/**
 * Build a launch-lease issuer that prefers installed broker CLI plus operator.json credentials.
 */
export async function resolveSecretsBrokerLaunchLeaseIssuer(
  brokerService: DiscoveredService | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SecretsBrokerLaunchLeaseIssuer | undefined> {
  const configuredCommand = env[LAUNCH_LEASE_COMMAND_ENV]?.trim();
  const operatorConfig = brokerService
    ? await readSecretsBrokerOperatorConfig(brokerService.serviceRoot)
    : null;
  const operatorEnv = operatorConfig && brokerService
    ? buildSecretsBrokerRuntimeEnv(operatorConfig, resolveSecretsBrokerDataPaths(brokerService.serviceRoot))
    : {};
  const mergedEnv = mergeSecretsBrokerOperatorEnv(operatorEnv, env);

  if (configuredCommand) {
    return {
      command: {
        command: configuredCommand,
        args: parseConfiguredLaunchLeaseArgs(env),
        env: mergedEnv,
      },
      workspaceId: env[WORKSPACE_ID_ENV],
    };
  }

  if (!brokerService) {
    return undefined;
  }

  const cli = resolveSecretsBrokerCli(brokerService);
  if (!cli) {
    return undefined;
  }

  return {
    command: {
      command: cli.command,
      args: cli.args,
      cwd: cli.cwd,
      env: mergedEnv,
    },
    workspaceId: env[WORKSPACE_ID_ENV],
  };
}

/**
 * Create a live `/v1/resolve` lookup when operator config and a broker port are available.
 * Returns undefined so start keeps the existing plumbing path in tests without a broker daemon.
 */
export function createSecretsBrokerLaunchLookup(options: {
  brokerService?: DiscoveredService;
  launchLeaseIssuer?: SecretsBrokerLaunchLeaseIssuer;
  workspaceId?: string;
}): BrokerLaunchLookup | undefined {
  const brokerService = options.brokerService;
  if (!brokerService) {
    return undefined;
  }

  return async ({ service, refs }) => {
    if (refs.length === 0) {
      return [];
    }

    const operatorConfig = await readSecretsBrokerOperatorConfig(brokerService.serviceRoot);
    const port = resolveSecretsBrokerPort(brokerService);
    if (!operatorConfig || port === null) {
      return unavailableDecisions(refs, "source-unavailable");
    }

    const identityLease = await issueSecretsBrokerLaunchLease(service, {
      launchLeaseIssuer: options.launchLeaseIssuer,
      transportBinding: null,
    });
    if (!identityLease) {
      return unavailableDecisions(refs, "auth-required");
    }

    const namespacedRefs = refs.map((ref) => namespacedRefForService(service, ref));
    const requestBody = {
      requestId: `service-lasso-start-${service.manifest.id}`,
      workspaceId: options.workspaceId?.trim() || options.launchLeaseIssuer?.workspaceId || DEFAULT_WORKSPACE_ID,
      serviceId: service.manifest.id,
      identityLease,
      purpose: "service-start",
      refs: namespacedRefs,
    };

    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/resolve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${operatorConfig.apiToken}`,
        },
        body: JSON.stringify(requestBody),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const errorOutcome = isRecord(payload) && isRecord(payload.error) && typeof payload.error.outcome === "string"
          ? payload.error.outcome
          : "source_unavailable";
        return unavailableDecisions(refs, mapResolveOutcome(errorOutcome));
      }

      const results = parseResolveResults(payload);
      const byNamespacedRef = new Map(results.map((entry) => [entry.ref, entry]));
      return refs.map((ref) => {
        const namespaced = namespacedRefForService(service, ref);
        const match = byNamespacedRef.get(namespaced) ?? byNamespacedRef.get(ref);
        if (!match) {
          return { ref, status: "missing" };
        }
        if (match.outcome === "ready" && match.value !== undefined) {
          return { ref, status: "resolved", value: match.value };
        }
        return { ref, status: mapResolveOutcome(match.outcome) };
      });
    } catch {
      return unavailableDecisions(refs, "source-unavailable");
    }
  };
}
