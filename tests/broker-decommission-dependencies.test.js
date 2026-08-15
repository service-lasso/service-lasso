import assert from "node:assert/strict";
import test from "node:test";

import { buildBrokerDecommissionDependencyEvidence } from "../dist/runtime/broker/decommission.js";

function service(id, refs = []) {
  return {
    manifestPath: `services/${id}/service.json`,
    rootPath: `services/${id}`,
    manifest: {
      id,
      name: id,
      description: `${id} test service`,
      enabled: true,
      autostart: false,
      broker: {
        imports: refs.map((ref) => ({ ref, required: true })),
      },
    },
  };
}

test("decommission evidence is clear only when no discovered service references the secret", () => {
  const evidence = buildBrokerDecommissionDependencyEvidence(
    [service("alpha", ["services.alpha.API_KEY"]), service("bravo")],
    "services.bravo.API_KEY",
  );

  assert.equal(evidence.dependencyStatus, "clear");
  assert.deepEqual(evidence.dependencies, []);
  assert.match(evidence.dependencySnapshot, /^sha256:[a-f0-9]{64}$/);
});

test("decommission evidence derives stable blockers from manifests instead of browser claims", () => {
  const services = [
    service("bravo", ["services.shared.API_KEY"]),
    service("alpha", ["services.shared.API_KEY", "services.shared.API_KEY"]),
  ];
  const first = buildBrokerDecommissionDependencyEvidence(services, "services.shared.API_KEY");
  const second = buildBrokerDecommissionDependencyEvidence([...services].reverse(), " services.shared.API_KEY ");

  assert.equal(first.dependencyStatus, "blocked");
  assert.deepEqual(first.dependencies, ["service:alpha", "service:bravo"]);
  assert.deepEqual(second, first);
});

test("decommission evidence maps a canonical Broker ref back to its namespaced manifest import", () => {
  const consumer = service("alpha");
  consumer.manifest.broker.imports = [{
    namespace: "services/alpha/runtime",
    ref: "secretsbroker.API_KEY",
    required: true,
  }];
  const evidence = buildBrokerDecommissionDependencyEvidence(
    [consumer],
    "services/alpha/runtime/secretsbroker.API_KEY",
  );
  assert.equal(evidence.dependencyStatus, "blocked");
  assert.deepEqual(evidence.dependencies, ["service:alpha"]);
});
