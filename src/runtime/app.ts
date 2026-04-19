import { describeRuntimeBoundary, createDefaultServiceRootConfig } from "./layout.js";

export interface RuntimeLayoutReport {
  mode: "scaffold";
  boundary: ReturnType<typeof describeRuntimeBoundary>;
  serviceRoot: ReturnType<typeof createDefaultServiceRootConfig>;
  nextTasks: string[];
}

export function createRuntimeLayoutReport(): RuntimeLayoutReport {
  return {
    mode: "scaffold",
    boundary: describeRuntimeBoundary(),
    serviceRoot: createDefaultServiceRootConfig(),
    nextTasks: [
      "TASK-007: add the first standalone runtime entrypoint behavior",
      "TASK-008: implement canonical service.json discovery/parsing",
      "TASK-009: add fixture-backed runtime smoke verification",
    ],
  };
}
