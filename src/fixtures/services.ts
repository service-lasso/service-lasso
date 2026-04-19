import type { ServiceSummary } from "../contracts/api.js";

export const FIXTURE_SERVICES: ServiceSummary[] = [
  {
    id: "@node",
    name: "Node Runtime",
    description: "Fixture runtime provider used to prove the first core API spine.",
    status: "fixture",
    source: "fixture",
  },
  {
    id: "@python",
    name: "Python Runtime",
    description: "Fixture runtime provider entry for the first bounded API slice.",
    status: "fixture",
    source: "fixture",
  },
  {
    id: "echo-service",
    name: "Echo Service",
    description: "Fixture sample service used by the first core API story.",
    status: "fixture",
    source: "fixture",
  },
];
