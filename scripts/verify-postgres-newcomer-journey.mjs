import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile, cp, rename, mkdir, readdir, stat } from "node:fs/promises";
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
let packageHash = null;
let manifest = null;
let readinessMs = null;
let postgresArchiveSha256 = null;

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
async function assertPortFree(port) {
  await new Promise((resolve, reject) => { const server = createServer(); server.once("error", () => reject(new Error(`Port ${port} is occupied; refusing to touch an unowned runtime.`))); server.listen(port, "127.0.0.1", () => server.close(resolve)); });
}
async function waitForExit(child, limit = 30_000) {
  if (child.exitCode !== null) return;
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((_, reject) => setTimeout(() => reject(new Error("Owned app did not exit within cleanup bound.")), limit))]);
}
async function action(name) {
  const response = await fetch(`http://127.0.0.1:18550/api/services/postgres/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }), signal: AbortSignal.timeout(30_000) });
  const body = await response.json();
  assert.equal(response.ok && body.ok, true, `${name} failed`);
}
async function capture(commandName, args, cwd) {
  return await new Promise((resolve, reject) => { let output = ""; const child = spawn(commandName, args, { cwd, env: isolatedEnv, shell: process.platform === "win32" }); child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; }); child.once("error", reject).once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`${commandName} failed: ${output}`))); });
}
async function findArchive(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) { const candidate = path.join(directory, entry.name); if (entry.isDirectory()) { const found = await findArchive(candidate); if (found) return found; } else if (/\.(?:zip|tgz|tar\.gz)$/u.test(entry.name) && (await stat(candidate)).size > 0) return candidate; }
  return null;
}
try {
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await mkdir(path.join(runRoot, "registries"), { recursive: true });
  await cp(example, consumer, { recursive: true, filter: (source) => !source.includes(`${path.sep}workspace`) && !source.includes("node_modules") });
  const packed = JSON.parse(await new Promise((resolve, reject) => {
    let out = ""; const child = spawn(npm, ["pack", "--json"], { cwd: consumer, shell: process.platform === "win32" }); child.stdout.on("data", (chunk) => { out += chunk; }); child.once("error", reject).once("exit", (code) => code === 0 ? resolve(out) : reject(new Error("npm pack failed")));
  }))[0];
  packageHash = digest(await readFile(path.join(consumer, packed.filename)));
  const archive = path.join(runRoot, packed.filename);
  await rename(path.join(consumer, packed.filename), archive);
  await rm(consumer, { recursive: true, force: true });
  await command("tar", ["-xf", archive, "-C", runRoot], root);
  await rm(archive, { force: true });
  const packaged = path.join(runRoot, "package");
  await command(npm, ["ci", "--ignore-scripts"], packaged);
  await command(npm, ["run", "setup"], packaged);
  const manifestPath = path.join(packaged, "workspace", "services", "postgres", "service.json");
  const archive = await findArchive(path.join(packaged, "workspace", "services", "postgres"));
  if (!archive) throw new Error("Downloaded PostgreSQL release archive was not retained beneath the isolated service root.");
  postgresArchiveSha256 = digest(await readFile(archive));
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.env.POSTGRES_MAX_CONNECTIONS = "120";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await assertPortFree(18550); await assertPortFree(18552);
  const started = Date.now();
  app = command(npm, ["start"], packaged, true);
  app.stdout.on("data", () => {}); app.stderr.on("data", () => {});
  await wait("http://127.0.0.1:18552", 200);
  readinessMs = Date.now() - started;
  const firstCheck = await capture(npm, ["run", "check"], packaged);
  assert.match(firstCheck, /PostgreSQL max_connections: 120/u, "configuration SQL assertion failed");
  await action("stop");
  await wait("http://127.0.0.1:18552", 503);
  await action("start");
  await wait("http://127.0.0.1:18552", 200);
  const recoveryCheck = await capture(npm, ["run", "check"], packaged);
  assert.match(recoveryCheck, /PostgreSQL max_connections: 120/u, "recovery configuration SQL assertion failed");
} finally {
  if (app) { app.kill("SIGTERM"); await waitForExit(app); }
  await command(npm, ["run", "stop"], path.join(runRoot, "package"));
  await assertPortFree(18550); await assertPortFree(18552);
  await writeFile(evidencePath, `${JSON.stringify({ schema: "service-lasso.postgres-newcomer-journey.v1", sourcePackageSha256: packageHash, postgresTag: manifest.artifact.source.tag, postgresManifestSha256: digest(await readFile(manifestPath)), postgresArchiveSha256, readinessMs, outcomes: { freshPackage: "success", sqlWriteRead: "success", configuration: "success", dependencyFailure: "success", recovery: "success", ownedCleanup: "success" } }, null, 2)}\n`);
  await rm(runRoot, { recursive: true, force: true });
}
