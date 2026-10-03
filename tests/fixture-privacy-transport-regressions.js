import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fixturePrivacyBootstrap, createFixturePrivacyDecoder } from "./fixture-privacy-transport.js";
import { fixturePrivacyScript } from "./fixture-privacy-custody.js";
import { decodeFixturePrivacyResponse, classifyFixturePrivacyCompletion, runFixturePrivacy, fixturePrivacyTransportFailureObservation } from "./hard-crash-fixture-custody.js";

const nonce = "1".repeat(32);
const normal = ["boot_enter", "parse_enter", "parse_ok", "compiler_enter", "compiler_ok", "native_enter_acquire"];
const frames = (events = normal, binding = nonce, role = "v") => events.map((event, index) => `SLFP2|${binding}|${role}|${index + 1}|${event}\n`).join("");
const response = (outcome = "passed", operation = null) => JSON.stringify({ schema: "service-lasso.fixture-privacy-response.v1", outcome, operation });
const decode = (chunks) => {
  const decoder = createFixturePrivacyDecoder(nonce, "v");
  for (const chunk of chunks) decoder.feed(chunk);
  return decoder.finish(decodeFixturePrivacyResponse);
};

// Register in the existing custody and selected-phase natural test entrypoints.
export function registerFixturePrivacyTransportTests() {
  test("SLFP2 decoder accepts every chunk boundary and preserves unavailable prefixes", () => {
    const transport = frames() + response();
    for (let split = 0; split <= transport.length; split++) {
      const result = decode([transport.slice(0, split), transport.slice(split)]);
      assert.equal(result.response, "passed");
      assert.equal(result.observation.state, "complete");
      assert.deepEqual(result.observation.events, normal);
      assert.doesNotMatch(JSON.stringify(result.observation), /11111111|SLFP2/);
    }
    assert.equal(decode([frames(normal.slice(0, 2)) + "SLFP2|"]).observation.state, "unavailable");
    assert.deepEqual(decode([frames(normal.slice(0, 2)) + "SLFP2|"]).observation.events, normal.slice(0, 2));
    assert.equal(decode([frames() + response().slice(0, -1)]).observation.state, "unavailable");
    assert.deepEqual(decode([frames(["boot_enter", "parse_enter", "parse_failed"])]).observation.events,
      ["boot_enter", "parse_enter", "parse_failed"]);
    assert.equal(decode([frames(["boot_enter", "parse_enter", "parse_ok", "compiler_enter", "compiler_failed"]) + response("failed", "compiler")]).response, "compiler");
    assert.equal(classifyFixturePrivacyCompletion(response("failed", "compiler"), true, false, true), "timeout_unavailable");
  });
  test("SLFP2 rejects hostile bindings, orders, framing, final grammar and prospective limits", () => {
    for (const transport of [
      frames(normal, "2".repeat(32)), frames(normal, nonce, "p"), frames().replace("|1|", "|01|"),
      frames().replace("|2|parse_enter", "|3|parse_enter"), frames().replace("parse_enter", "parse_ok"),
      frames().replace("compiler_ok", "compiler_failed") + frames().split("\n")[5] + "\n",
      frames().replace("native_enter_acquire", "native_enter_unknown"), frames() + frames(["boot_enter"]),
      "unframed" + frames(), frames() + "\u00e9", frames() + response() + response(),
      frames() + response() + "\n", frames(normal.slice(0, 3)) + response(),
      frames().replace("boot_enter", "a".repeat(129)), "a".repeat(16_385),
    ]) {
      const result = decode([transport]);
      assert.equal(result.response, undefined);
      assert.equal(result.observation.state, "malformed");
      assert.equal(result.observation.events.length <= 6, true);
    }
    const bounded = createFixturePrivacyDecoder(nonce, "v");
    bounded.feed(frames()); bounded.feed(Buffer.alloc(16_384));
    assert.equal(bounded.finish(decodeFixturePrivacyResponse).observation.state, "malformed");
  });
  test("owned execFile rejection and observer failure preserve exact primary identity", async () => {
    const priorSystemRoot = process.env.SystemRoot;
    process.env.SystemRoot ??= "C:\\Windows";
    const original = new Proxy({}, { get() { throw new Error("PRIVATE-ERROR-GETTER"); } });
    let witness;
    let originalOptions;
    const launch = (_exe, args, options, callback) => {
      originalOptions = options;
      assert.equal(args.at(-1), fixturePrivacyBootstrap);
      assert.equal(options.env.SERVICE_LASSO_FIXTURE_PRIVACY_PAYLOAD, fixturePrivacyScript);
      const child = new EventEmitter(); child.stdout = new EventEmitter();
      queueMicrotask(() => {
        child.emit("spawn");
        child.stdout.emit("data", frames(normal, options.env.SERVICE_LASSO_FIXTURE_PRIVACY_NONCE, options.env.SERVICE_LASSO_FIXTURE_PRIVACY_ROLE));
        callback(original, "");
      });
      return child;
    };
    try {
      await assert.rejects(runFixturePrivacy("PRIVATE-ROOT", false, (_result, record) => { witness = record; throw original; }, launch), error => error === original);
    } finally {
      if (priorSystemRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = priorSystemRoot;
    }
    assert.equal(originalOptions.timeout, 5_000); assert.equal(originalOptions.maxBuffer, 16 * 1024);
    assert.deepEqual(fixturePrivacyTransportFailureObservation(original), witness);
    assert.equal(witness.state, "unavailable");
    assert.doesNotMatch(JSON.stringify(witness), /PRIVATE|11111111|payload/);
  });
  test("actual fixed bootstrap distinguishes payload parser, compiler and bootstrap failure", { skip: process.platform !== "win32" }, async () => {
    const invoke = promisify(execFile);
    for (const [payload, bootstrap, expected] of [
      ["if (", fixturePrivacyBootstrap, ["boot_enter", "parse_enter", "parse_failed"]],
      [fixturePrivacyScript.replace("public static class FixturePrivacy {", "public static class PRIVATE_INVALID_COMPILER { !!!"), fixturePrivacyBootstrap,
        ["boot_enter", "parse_enter", "parse_ok", "compiler_enter", "compiler_failed"]],
      [fixturePrivacyScript, "if (", []],
    ]) {
      const binding = randomBytes(16).toString("hex");
      let rejected;
      try {
        await invoke(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoProfile", "-NonInteractive", "-Command", bootstrap], {
            windowsHide: true, timeout: 5_000, maxBuffer: 16 * 1024,
            env: { ...process.env, SERVICE_LASSO_FIXTURE_PRIVACY_NONCE: binding,
              SERVICE_LASSO_FIXTURE_PRIVACY_ROLE: "v", SERVICE_LASSO_FIXTURE_PRIVACY_PAYLOAD: payload },
          });
      } catch (error) { rejected = error; }
      assert.ok(rejected); assert.notEqual(rejected.code, 0);
      const decoder = createFixturePrivacyDecoder(binding, "v"); decoder.feed(rejected.stdout);
      const result = decoder.finish(decodeFixturePrivacyResponse);
      assert.deepEqual(result.observation.events, expected);
      assert.doesNotMatch(JSON.stringify(result.observation), /PRIVATE|System32|ErrorRecord/);
      if (expected.includes("compiler_failed")) assert.equal(result.response, "compiler");
      else assert.equal(result.response, undefined);
    }
  });
}
