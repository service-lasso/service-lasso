import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, cp, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.cwd());
const example = path.join(root, "examples", "postgres-app");
const runRoot = await mkdtemp(path.join(tmpdir(), "service-lasso-postgres-journey-"));
const isolatedEnv = { ...process.env, SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(runRoot, "registries", "instances.json"), SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(runRoot, "registries", "ports.json") };
const consumer = path.join(runRoot, "postgres-app");
const evidencePath = process.env.POSTGRES_JOURNEY_EVIDENCE ?? path.join(root, "artifacts", "postgres-journey.json");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let app;

function command(command, args, cwd, background = false) {
  const child = spawn(command, args, { cwd, env: isolatedEnv, shell: process.platform === "win32", stdio: background ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (background) return child;
  return new Promise((resolve, reject) => child.once("error", reject).once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
async function wait(url, expected, limit = 90_000) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(2_000) }); if (response.status === expected) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not return ${expected}`);
}
async function action(name) {
  const response = await fetch(`http://127.0.0.1:18550/api/services/postgres/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }), signal: AbortSignal.timeout(30_000) });
  const body = await response.json();
  assert.equal(response.ok && body.ok, true, `${name} failed`);
}
try {
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await mkdir(path.join(runRoot, "registries"), { recursive: true });
  await cp(example, consumer, { recursive: true, filter: (source) => !source.includes(`${path.sep}workspace`) && !source.includes("node_modules") });
  const packed = JSON.parse(await new Promise((resolve, reject) => {
    let out = ""; const child = spawn(npm, ["pack", "--json"], { cwd: consumer, shell: process.platform === "win32" }); child.stdout.on("data", (chunk) => { out += chunk; }); child.once("error", reject).once("exit", (code) => code === 0 ? resolve(out) : reject(new Error("npm pack failed")));
  }))[0];
  const packageHash = digest(await readFile(path.join(consumer, packed.filename)));
  const archive = path.join(runRoot, packed.filename);
  await rename(path.join(consumer, packed.filename), archive);
  await rm(consumer, { recursive: true, force: true });
  await command("tar", ["-xf", archive, "-C", runRoot], root);
  await rm(archive, { force: true });
  const packaged = path.join(runRoot, "package");
  await command(npm, ["ci", "--ignore-scripts"], packaged);
  await command(npm, ["run", "setup"], packaged);
  const manifestPath = path.join(packaged, "workspace", "services", "postgres", "service.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.env.POSTGRES_MAX_CONNECTIONS = "120";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const started = Date.now();
  app = command(npm, ["start"], packaged, true);
  app.stdout.on("data", () => {}); app.stderr.on("data", () => {});
  await wait("http://127.0.0.1:18552", 200);
  const readinessMs = Date.now() - started;
  await command(npm, ["run", "check"], packaged);
  await action("stop");
  await wait("http://127.0.0.1:18552", 503);
  await action("start");
  await wait("http://127.0.0.1:18552", 200);
  await command(npm, ["run", "check"], packaged);
  await writeFile(evidencePath, `${JSON.stringify({ schema: "service-lasso.postgres-newcomer-journey.v1", sourcePackageSha256: packageHash, postgresTag: manifest.artifact.source.tag, postgresManifestSha256: digest(await readFile(manifestPath)), readinessMs, outcomes: { freshPackage: "success", sqlWriteRead: "success", configuration: "success", dependencyFailure: "success", recovery: "success" } }, null, 2)}\n`);
} finally {
  app?.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  await command(npm, ["run", "stop"], path.join(runRoot, "package")).catch(() => {});
  await rm(runRoot, { recursive: true, force: true });
}
