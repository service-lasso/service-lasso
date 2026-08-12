import type { DiscoveredService } from "../../contracts/service.js";
import { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { createDirectExecutionPlan } from "./direct.js";
import { createJavaExecutionPlan } from "./java.js";
import { createNodeExecutionPlan } from "./node.js";
import { createPythonExecutionPlan } from "./python.js";
import type { ProviderExecutionPlan } from "./types.js";
import { getLifecycleState } from "../lifecycle/store.js";

export type ProviderReadinessStatus =
  | "ready"
  | "not-installed"
  | "not-configured"
  | "artifact-command-missing"
  | "artifact-root-missing";

export interface ProviderReadiness {
  status: ProviderReadinessStatus;
  ready: boolean;
  detail: string;
}

export class ProviderNotReadyError extends Error {
  readonly code = "provider_not_ready";
  readonly statusCode = 409;

  constructor(
    readonly providerServiceId: string,
    readonly readiness: ProviderReadiness,
  ) {
    super(`Provider service "${providerServiceId}" is not ready for provider-backed execution: ${readiness.detail}`);
    this.name = "ProviderNotReadyError";
  }
}

export function getProviderReadiness(providerService: DiscoveredService): ProviderReadiness {
  const providerServiceId = providerService.manifest.id;
  const lifecycle = getLifecycleState(providerServiceId);
  if (!lifecycle.installed) {
    return { status: "not-installed", ready: false, detail: "install has not completed." };
  }
  if (!lifecycle.configured) {
    return { status: "not-configured", ready: false, detail: "configuration has not completed." };
  }

  if (providerService.manifest.artifact) {
    const installedArtifact = lifecycle.installArtifacts.artifact;
    if (!installedArtifact?.command) {
      return {
        status: "artifact-command-missing",
        ready: false,
        detail: "the installed release artifact command is unavailable.",
      };
    }
    if (!installedArtifact.extractedPath) {
      return {
        status: "artifact-root-missing",
        ready: false,
        detail: "the installed release artifact root is unavailable.",
      };
    }
  }

  return { status: "ready", ready: true, detail: "Provider install and configuration are ready." };
}

export function resolveProviderExecution(
  service: DiscoveredService,
  registry: ServiceRegistry,
): ProviderExecutionPlan {
  const providerServiceId = service.manifest.execservice;

  if (!providerServiceId) {
    return createDirectExecutionPlan(service.manifest);
  }

  const providerService = registry.getById(providerServiceId);
  if (!providerService) {
    throw new Error(`Unknown provider service id: ${providerServiceId}`);
  }
  const readiness = getProviderReadiness(providerService);
  if (!readiness.ready) {
    throw new ProviderNotReadyError(providerServiceId, readiness);
  }
  const providerArtifact = getLifecycleState(providerServiceId).installArtifacts.artifact;

  switch (providerServiceId) {
    case "@node":
      return createNodeExecutionPlan(service.manifest, providerService.manifest, providerArtifact);
    case "@python":
      return createPythonExecutionPlan(service.manifest, providerService.manifest, providerArtifact);
    case "@java":
      return createJavaExecutionPlan(service.manifest, providerService.manifest, providerArtifact);
    default:
      throw new Error(`Unsupported provider service id: ${providerServiceId}`);
  }
}
