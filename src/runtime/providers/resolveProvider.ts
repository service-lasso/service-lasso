import type { DiscoveredService } from "../../contracts/service.js";
import { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { createDirectExecutionPlan } from "./direct.js";
import { createNodeExecutionPlan } from "./node.js";
import { createPythonExecutionPlan } from "./python.js";
import type { ProviderExecutionPlan } from "./types.js";

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

  switch (providerServiceId) {
    case "@node":
      return createNodeExecutionPlan(service.manifest, providerService.manifest);
    case "@python":
      return createPythonExecutionPlan(service.manifest, providerService.manifest);
    default:
      throw new Error(`Unsupported provider service id: ${providerServiceId}`);
  }
}
