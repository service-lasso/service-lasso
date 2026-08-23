import { createHash } from "node:crypto";
import type { DiscoveredService } from "../../contracts/service.js";
import { serviceConsumesBrokerReference } from "../operator/secret-audit.js";

export interface BrokerDecommissionDependencyEvidence {
  dependencyStatus: "clear" | "blocked";
  dependencySnapshot: string;
  dependencies: string[];
}

export function buildBrokerDecommissionDependencyEvidence(
  services: DiscoveredService[],
  ref: string,
): BrokerDecommissionDependencyEvidence {
  const normalizedRef = ref.trim();
  const dependencies = services
    .filter((service) => serviceConsumesBrokerReference(service, normalizedRef))
    .map((service) => `service:${service.manifest.id}`)
    .filter((serviceId, index, values) => values.indexOf(serviceId) === index)
    .sort();
  const snapshotPayload = JSON.stringify({
    ref: normalizedRef,
    dependencies,
  });

  return {
    dependencyStatus: dependencies.length === 0 ? "clear" : "blocked",
    dependencySnapshot: `sha256:${createHash("sha256").update(snapshotPayload).digest("hex")}`,
    dependencies,
  };
}
