import test from "node:test";
import assert from "node:assert/strict";
import { observeNativeAcknowledgementContainment } from "../dist/runtime/execution/native-ack-containment.js";

test("native acknowledgement completion cancels only its helper and requires stopped proof", async () => {
  const outer = new AbortController();
  let helperSignal;
  let verified = false;
  await observeNativeAcknowledgementContainment({
    signal: outer.signal,
    exit: Promise.resolve({ exitCode: 106, signal: null }),
    terminate: (signal) => {
      helperSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("helper cancelled"))));
    },
    verifyStopped: async () => {
      assert.equal(helperSignal.aborted, true);
      assert.equal(outer.signal.aborted, false);
      verified = true;
    },
  });
  assert.equal(verified, true);
});

for (const exit of [
  { exitCode: 0, signal: null },
  { exitCode: 1, signal: null },
  { exitCode: null, signal: null },
  { exitCode: 106, signal: "SIGKILL" },
]) {
  test(`exit ${JSON.stringify(exit)} cannot waive termination failure`, async () => {
    const failure = new Error("termination failed");
    let verified = false;
    await assert.rejects(observeNativeAcknowledgementContainment({
      signal: new AbortController().signal,
      exit: Promise.resolve(exit),
      terminate: async () => { throw failure; },
      verifyStopped: async () => { verified = true; },
    }), (error) => error === failure);
    assert.equal(verified, false);
  });
}

test("native completion does not waive failed tree convergence", async () => {
  const failure = new Error("tree still live");
  await assert.rejects(observeNativeAcknowledgementContainment({
    signal: new AbortController().signal,
    exit: Promise.resolve({ exitCode: 106, signal: null }),
    terminate: () => new Promise(() => undefined),
    verifyStopped: async () => { throw failure; },
  }), (error) => error === failure);
});

test("expired caller cannot approve native completion", async () => {
  const controller = new AbortController();
  controller.abort();
  let touched = false;
  await assert.rejects(observeNativeAcknowledgementContainment({
    signal: controller.signal,
    exit: Promise.resolve({ exitCode: 106, signal: null }),
    terminate: async () => { touched = true; },
    verifyStopped: async () => { touched = true; },
  }), { name: "AbortError" });
  assert.equal(touched, false);
});

test("observed native completion proves stopped state without starting a helper", async () => {
  let verified = false;
  await observeNativeAcknowledgementContainment({
    signal: new AbortController().signal,
    nativeObservationMs: 100,
    exit: Promise.resolve({ exitCode: 106, signal: null }),
    terminate: async () => { assert.fail("helper must not preempt native completion"); },
    verifyStopped: async () => { verified = true; },
  });
  assert.equal(verified, true);
});

test("observation expiry retains ordinary termination", async () => {
  let terminated = false;
  await observeNativeAcknowledgementContainment({
    signal: new AbortController().signal,
    nativeObservationMs: 1,
    exit: new Promise(() => undefined),
    terminate: async () => { terminated = true; },
    verifyStopped: async () => { assert.fail("absent native exit is not proof"); },
  });
  assert.equal(terminated, true);
});

test("caller cancellation during observation prevents later termination", async () => {
  const controller = new AbortController();
  const reason = new Error("caller expired");
  const pending = observeNativeAcknowledgementContainment({
    signal: controller.signal,
    nativeObservationMs: 100,
    exit: new Promise(() => undefined),
    terminate: async () => { assert.fail("cancelled caller cannot start helper"); },
    verifyStopped: async () => { assert.fail("cancelled caller cannot approve stop"); },
  });
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
});
