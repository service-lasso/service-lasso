import test from "node:test";
import assert from "node:assert/strict";
import { serviceTerminalConfig } from "../dist/runtime/execution/supervisor.js";

function service(terminal) {
  return { manifest: { terminal } };
}

test("terminal configuration is opt-in", () => {
  assert.equal(serviceTerminalConfig(service(undefined)), null);
  assert.equal(serviceTerminalConfig(service({ enabled: false })), null);
});

test("terminal configuration applies bounded defaults", () => {
  const config = serviceTerminalConfig(service({ enabled: true }));
  assert.deepEqual(config, {
    rows: 24,
    cols: 80,
    readOnly: false,
    idleTimeoutMs: 15 * 60 * 1000,
    maxSessionMs: 8 * 60 * 60 * 1000,
  });
});

test("terminal configuration carries explicit hardening", () => {
  const config = serviceTerminalConfig(service({
    enabled: true,
    rows: 40,
    cols: 120,
    readOnly: true,
    idleTimeoutMs: 120_000,
    maxSessionMs: 7_200_000,
  }));
  assert.deepEqual(config, {
    rows: 40,
    cols: 120,
    readOnly: true,
    idleTimeoutMs: 120_000,
    maxSessionMs: 7_200_000,
  });
});

test("terminal configuration clamps out-of-range values", () => {
  const config = serviceTerminalConfig(service({
    enabled: true,
    rows: 0,
    cols: 5000,
    idleTimeoutMs: 1,
    maxSessionMs: 999_999_999_999,
  }));
  assert.equal(config.rows, 1);
  assert.equal(config.cols, 1000);
  assert.equal(config.idleTimeoutMs, 60_000);
  assert.equal(config.maxSessionMs, 604_800_000);
});
