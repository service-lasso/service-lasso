import test from "node:test";
import assert from "node:assert/strict";
import { validateServiceManifest } from "../dist/runtime/discovery/validateManifest.js";
import {
  assertIsolationStartAllowed,
  evaluateServiceIsolation,
} from "../dist/runtime/isolation/evaluate.js";

const manifestPath = "/tmp/isolation-service.json";

function baseManifest(isolation) {
  return {
    id: "iso-sample",
    name: "Isolation Sample",
    description: "Fixture for isolation ladder parse and start gates.",
    isolation,
  };
}

test("omitted isolation defaults to direct with no start block", () => {
  const manifest = validateServiceManifest(baseManifest(undefined), manifestPath);
  assert.equal(manifest.isolation, undefined);
  const status = evaluateServiceIsolation(manifest.isolation);
  assert.equal(status.declaredMode, "direct");
  assert.equal(status.require, "none");
  assert.equal(status.startBlocked, false);
  assertIsolationStartAllowed(status, "iso-sample");
});

test("compose-scripts mode parses and does not block start", () => {
  const manifest = validateServiceManifest(
    baseManifest({
      mode: "compose-scripts",
      workspace: ["runtime/data"],
    }),
    manifestPath,
  );
  assert.equal(manifest.isolation?.mode, "compose-scripts");
  assert.deepEqual(manifest.isolation?.workspace, ["runtime/data"]);
  const status = evaluateServiceIsolation(manifest.isolation);
  assert.equal(status.effectiveMode, "compose-scripts");
  assert.equal(status.startBlocked, false);
});

test("workspace paths cannot escape the service root", () => {
  assert.throws(
    () =>
      validateServiceManifest(
        baseManifest({
          workspace: ["../escape"],
        }),
        manifestPath,
      ),
    /stay inside the service root/,
  );
});

test("unknown isolation.mode is rejected", () => {
  assert.throws(
    () =>
      validateServiceManifest(
        baseManifest({
          mode: "provider",
        }),
        manifestPath,
      ),
    /isolation.mode/,
  );
});

test("require limits fails closed until Core applies caps", () => {
  const manifest = validateServiceManifest(
    baseManifest({
      require: "limits",
      limits: {
        memoryMb: 512,
      },
    }),
    manifestPath,
  );
  const status = evaluateServiceIsolation(manifest.isolation);
  assert.equal(status.limitsEnforced, false);
  assert.equal(status.startBlocked, true);
  assert.throws(() => assertIsolationStartAllowed(status, "iso-sample"), /isolation.require="limits"/);
});

test("require dedicated-user fails closed", () => {
  const status = evaluateServiceIsolation({ require: "dedicated-user" });
  assert.throws(() => assertIsolationStartAllowed(status, "iso-sample"), /dedicated service-user/);
});
