#!/usr/bin/env node
// Cross-repository operator/v2 product suite. Every selected lane runs even if an
// earlier lane fails; the process exits nonzero only after the summary.
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const coreRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliRoot = path.resolve(process.env.SERVICE_LASSO_CLI_ROOT ?? path.join(coreRoot, "..", "service-lasso-cli"));
const tuiRoot = path.resolve(process.env.SERVICE_LASSO_TUI_ROOT ?? path.join(coreRoot, "..", "service-lasso-tui"));
const logRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-v2-e2e-"));
const go = process.env.GO ?? "go";
const npm = process.env.NPM ?? "npm";
const node = process.execPath;
const npmCli = process.env.NPM_CLI ?? null;
const timeoutMs = Number(process.env.V2_E2E_TIMEOUT_MS ?? 15 * 60 * 1000);

function childEnvironment(extra = {}) {
  const environment = { ...process.env, ...extra };
  const pathEntries = [path.dirname(node), path.dirname(go), environment.PATH].filter(Boolean);
  environment.PATH = [...new Set(pathEntries)].join(path.delimiter);
  return environment;
}

function runLane(name, command, args, cwd, extraEnv = {}) {
  return new Promise((resolve) => {
    const logPath = path.join(logRoot, `${name.replaceAll(/[^a-z0-9._-]+/gi, "-")}.log`);
    const started = Date.now();
    let output = "";
    const child = spawn(command, args, { cwd, env: childEnvironment(extraEnv), stdio: ["ignore", "pipe", "pipe"] });
    const append = (chunk) => { const text = chunk.toString(); output += text; process.stdout.write(`[${name}] ${text}`); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      append(`\n[${name}] TIMEOUT after ${timeoutMs}ms; terminating\n`);
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ name, status: "failed", code: null, signal: null, durationMs: Date.now() - started, logPath, output, error: String(error) });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ name, status: code === 0 && !signal ? "passed" : "failed", code, signal, durationMs: Date.now() - started, logPath, output });
    });
  });
}

const lanes = [];
lanes.push(await runLane("core-v2", npm, ["run", "test:v2"], coreRoot));
lanes.push(await runLane("cli-full", "bash", ["-lc", "umask 0022; npm test"], cliRoot, npmCli ? { NPM_CLI: npmCli } : {}));
lanes.push(await runLane("tui-go", go, ["test", "./..."], tuiRoot));

const e2eCore = process.env.SERVICE_LASSO_TUI_E2E_CORE;
if (e2eCore) {
  const expectedRevision = process.env.SERVICE_LASSO_TUI_E2E_REVISION;
  if (!expectedRevision) {
    lanes.push({ name: "tui-local-e2e", status: "failed", durationMs: 0, output: "SERVICE_LASSO_TUI_E2E_REVISION is required with SERVICE_LASSO_TUI_E2E_CORE." });
  } else {
    const e2eOutput = path.join(logRoot, "tui-local-e2e-output");
    lanes.push(await runLane("tui-local-e2e", node, [
      "scripts/run-local-e2e.mjs",
      "--core-dir", path.resolve(e2eCore),
      "--expected-core-revision", expectedRevision,
      "--suite", "v2",
      "--output-dir", e2eOutput,
      "--npm-cli", npmCli ?? path.join(path.dirname(node), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
      "--python", process.env.PYTHON ?? "python3",
    ], tuiRoot));
  }
} else {
  lanes.push({ name: "tui-local-e2e", status: "skipped", durationMs: 0, output: "Set SERVICE_LASSO_TUI_E2E_CORE and SERVICE_LASSO_TUI_E2E_REVISION to run the clean-checkout TUI terminal proof." });
}

for (const lane of lanes) {
  process.stdout.write(`\n=== ${lane.name}: ${lane.status.toUpperCase()}${lane.code === undefined ? "" : ` (exit ${lane.code}${lane.signal ? `, ${lane.signal}` : ""})`} in ${lane.durationMs}ms ===\n`);
  if (lane.logPath) process.stdout.write(`log: ${lane.logPath}\n`);
  if (lane.status !== "passed") process.stdout.write(`${lane.output?.slice(-4000) ?? ""}\n`);
}

const failed = lanes.filter((lane) => lane.status === "failed");
process.stdout.write(`\nV2 E2E SUMMARY: ${lanes.length - failed.length}/${lanes.length} passed, ${failed.length} failed\n`);
process.stdout.write(`Logs retained in ${logRoot}\n`);
if (failed.length) process.exitCode = 1;
