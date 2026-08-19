import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardSummary } from "../dist/runtime/operator/dashboard.js";

function service(overrides = {}) {
  return {
    id: "echo-service",
    name: "Echo Service",
    status: "running",
    favorite: false,
    note: "ok",
    links: [],
    installed: true,
    role: "service",
    runtimeHealth: {
      state: "running",
      health: "healthy",
      summary: "ok",
    },
    endpoints: [],
    metadata: {
      serviceType: "app",
      runtime: "direct",
      version: "0.1.0",
      build: "test",
    },
    dependencies: [],
    dependents: [],
    environmentVariables: [],
    recentLogs: [],
    actions: [],
    ...overrides,
  };
}

test("empty favorites do not mark runtime health as warning", () => {
  const summary = buildDashboardSummary([service()]);

  assert.equal(summary.runtime.status, "healthy");
  assert.equal(summary.runtime.warningCount, 0);
  assert.equal(summary.favorites.length, 0);
  assert.equal(summary.others[0].id, "echo-service");
  assert.equal(
    summary.warnings.includes("No favorite services are configured for quick access."),
    false,
  );
});

test("favorited services still appear in dashboard favorites", () => {
  const summary = buildDashboardSummary([service({ favorite: true })]);

  assert.equal(summary.runtime.status, "healthy");
  assert.equal(summary.favorites[0].id, "echo-service");
  assert.equal(summary.others.length, 0);
});

test("stopped services still produce a runtime warning", () => {
  const summary = buildDashboardSummary([service({ status: "stopped", favorite: false })]);

  assert.equal(summary.runtime.status, "warning");
  assert.equal(summary.runtime.warningCount, 1);
  assert.ok(summary.warnings.includes("At least one managed service is currently stopped."));
  assert.equal(
    summary.warnings.includes("No favorite services are configured for quick access."),
    false,
  );
});
