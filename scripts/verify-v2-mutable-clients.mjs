import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { startApiServer } from "../dist/server/index.js";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tuiRoot = process.env.SERVICE_LASSO_TUI_ROOT ?? path.resolve(root, "../service-lasso-tui");
const cliRoot = process.env.SERVICE_LASSO_CLI_ROOT ?? path.resolve(root, "../service-lasso-cli");
const go = process.env.GO ?? "go";
const fixture = path.join(root, "fixtures/operator-v2-mutable");
const admission = JSON.parse(await readFile(path.join(fixture, "admission.json"), "utf8"));
const manifest = await readFile(path.join(fixture, "service.json"));
if (admission.production !== false || admission.mode !== "local-disposable") throw new Error("mutable fixture admission is not local-disposable");
if (createHash("sha256").update(manifest).digest("hex") !== admission.manifestSha256) throw new Error("mutable fixture manifest hash mismatch");

const temp = await mkdtemp(path.join(os.tmpdir(), "service-lasso-v2-mutable-"));
const servicesRoot = path.join(temp, "services");
const workspaceRoot = path.join(temp, "workspace");
const serviceRoot = path.join(servicesRoot, "operator-v2-fixture");
const probe = path.join(temp, "service-lasso-operator-probe");
await mkdir(servicesRoot);
await mkdir(workspaceRoot);
await cp(fixture, serviceRoot, { recursive: true });
const cli = path.join(cliRoot, "dist/index.js");
let server;

async function cliCommand(args) {
  const { stdout } = await execFileAsync(process.execPath, [cli, "--core-url", server.url, ...args], { encoding: "utf8" });
  return JSON.parse(stdout);
}

async function waitOperation(operationId) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const readback = await cliCommand(["operator", "operation", operationId, "--json"]);
    if (!["queued", "running", "cancelling"].includes(readback.operation.status)) return readback;
    if (Date.now() >= deadline) throw new Error(`operation ${operationId} did not settle`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

try {
  execFileAsync(go, ["build", "-o", probe, "./cmd/service-lasso-operator-probe"], { cwd: tuiRoot }).catch(() => undefined);
  await execFileAsync(go, ["build", "-o", probe, "./cmd/service-lasso-operator-probe"], { cwd: tuiRoot });
  server = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  const preview = await cliCommand(["operator", "preview", "operator-v2-fixture", "service_start", "--json"]);
  if (!preview.planId || !preview.confirmation?.id || !preview.confirmation?.phraseKey) throw new Error("start preview incomplete");
  const started = await cliCommand([
    "operator", "execute", "operator-v2-fixture",
    "--plan-id", preview.planId,
    "--idempotency-key", "fixture-start-000001",
    "--confirmation-id", preview.confirmation.id,
    "--confirmation-response", preview.confirmation.phraseKey,
    "--expected-revision", preview.expectedRevision,
    "--confirm", "--json",
  ]);
  const operationId = started.operation.operationId;
  if (!operationId) throw new Error("start execute did not return an operation");
  const settled = await waitOperation(operationId);
  if (settled.operation.status !== "succeeded") throw new Error(`start operation ${settled.operation.status}`);

  const cancelled = await cliCommand(["operator", "cancel", operationId, "--confirm", "--json"]);
  if (!["requested", "unsupported", "too_late"].includes(cancelled.status)) throw new Error("cancel response invalid");

  const stopPreview = await cliCommand(["operator", "preview", "operator-v2-fixture", "service_stop", "--json"]);
  const stopped = await cliCommand([
    "operator", "execute", "operator-v2-fixture",
    "--plan-id", stopPreview.planId,
    "--idempotency-key", "fixture-stop-000001",
    "--confirmation-id", stopPreview.confirmation.id,
    "--confirmation-response", stopPreview.confirmation.phraseKey,
    "--expected-revision", stopPreview.expectedRevision,
    "--confirm", "--json",
  ]);
  const stopSettled = await waitOperation(stopped.operation.operationId);
  if (stopSettled.operation.status !== "succeeded") throw new Error(`stop operation ${stopSettled.operation.status}`);

  const tuiOutput = (await execFileAsync(probe, [server.url, "operator-v2-fixture"], {
    encoding: "utf8",
    env: { ...process.env, SERVICE_LASSO_PROBE_MUTATE: "1", SERVICE_LASSO_PROBE_ACTION: "service_start" },
  })).stdout.trim().split("\n");
  if (!tuiOutput[0].endsWith(" 1 true")) throw new Error(`TUI discovery/context mismatch: ${tuiOutput[0]}`);
  if (!tuiOutput.includes("detail operator-v2-fixture " + preview.expectedRevision)) throw new Error("TUI detail revision mismatch");
  if (!tuiOutput.includes("availability operator-v2-fixture true")) throw new Error("TUI availability mismatch");
  if (!tuiOutput.some((line) => line.startsWith("preview operator-v2-fixture "))) throw new Error("TUI preview missing");
  if (!tuiOutput.some((line) => line.startsWith("execute accepted ") || line.startsWith("execute completed "))) throw new Error("TUI execute missing");
  if (!tuiOutput.some((line) => /^cancel (requested|too_late|unsupported)$/.test(line))) throw new Error("TUI cancel missing");

  const tuiStopPreview = await cliCommand(["operator", "preview", "operator-v2-fixture", "service_stop", "--json"]);
  const tuiStopped = await cliCommand([
    "operator", "execute", "operator-v2-fixture",
    "--plan-id", tuiStopPreview.planId,
    "--idempotency-key", "fixture-tui-stop-000001",
    "--confirmation-id", tuiStopPreview.confirmation.id,
    "--confirmation-response", tuiStopPreview.confirmation.phraseKey,
    "--expected-revision", tuiStopPreview.expectedRevision,
    "--confirm", "--json",
  ]);
  const tuiStopSettled = await waitOperation(tuiStopped.operation.operationId);
  if (tuiStopSettled.operation.status !== "succeeded") throw new Error(`TUI stop operation ${tuiStopSettled.operation.status}`);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    core: server.url,
    start: settled.operation.status,
    cancel: cancelled.status,
    stop: stopSettled.operation.status,
    tuiStart: tuiOutput.find((line) => line.startsWith("execute ")),
    tuiCancel: tuiOutput.find((line) => line.startsWith("cancel ")),
    tuiStop: tuiStopSettled.operation.status,
    tui: tuiOutput,
  })}\n`);
} finally {
  await server?.stop().catch(() => undefined);
  await rm(temp, { recursive: true, force: true });
}
