import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { DependencyGraph, createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

test("global startup order uses serviceorder for ready independent services without weakening dependencies", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-serviceorder-");

  try {
    await writeExecutableFixtureService(servicesRoot, "z-unordered");
    await writeExecutableFixtureService(servicesRoot, "middle", {
      serviceorder: 50,
    });
    await writeExecutableFixtureService(servicesRoot, "legacy-first", {
      execconfig: {
        serviceorder: 5,
      },
    });
    await writeExecutableFixtureService(servicesRoot, "blocked-low-priority", {
      serviceorder: 1,
      depend_on: ["late-provider"],
    });
    await writeExecutableFixtureService(servicesRoot, "independent-mid", {
      serviceorder: 200,
    });
    await writeExecutableFixtureService(servicesRoot, "late-provider", {
      serviceorder: 500,
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));

    assert.deepEqual(graph.getGlobalStartupOrder(), [
      "legacy-first",
      "middle",
      "independent-mid",
      "late-provider",
      "blocked-low-priority",
      "z-unordered",
    ]);
    assert.deepEqual(graph.getGlobalShutdownOrder(), [
      "z-unordered",
      "blocked-low-priority",
      "late-provider",
      "independent-mid",
      "middle",
      "legacy-first",
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("startup dependency lists are resolved by serviceorder when dependencies are independent", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-serviceorder-dependencies-");

  try {
    await writeExecutableFixtureService(servicesRoot, "slow-provider", {
      serviceorder: 50,
    });
    await writeExecutableFixtureService(servicesRoot, "fast-provider", {
      serviceorder: 5,
    });
    await writeExecutableFixtureService(servicesRoot, "target", {
      depend_on: ["slow-provider", "fast-provider"],
    });

    const graph = new DependencyGraph(createServiceRegistry(await discoverServices(servicesRoot)));

    assert.deepEqual(graph.getStartupOrder("target"), ["fast-provider", "slow-provider"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
