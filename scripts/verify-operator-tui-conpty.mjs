import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractZipSafely } from "../dist/runtime/files/safe-zip.js";
import { extractPlatformReleaseArchive, runCommand, stageReleaseArtifact } from "./release-artifact-lib.mjs";
import { verifyRetainedOperatorTools } from "./operator-tool-packaging-lib.mjs";
import { parseConptyProbeResult } from "./operator-tui-conpty-result.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32") {
  console.log(JSON.stringify({ ok: true, classification: "not_applicable" }));
  process.exit(0);
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-tui-conpty-"));
const outputRoot = path.join(tempRoot, "artifacts");
const tuiRoot = path.join(tempRoot, "tui");
const helperPath = path.join(repoRoot, "scripts", "verify-operator-tui-conpty.py");
let extractedCoreArchive;
let apiServer;
let unavailableServer;
const previousLocalAdminToken = process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;

function ownedLoopbackUnavailableEndpoint() {
  return new Promise((resolve, reject) => {
    unavailableServer = createServer((_request, response) => response.destroy());
    unavailableServer.once("error", reject);
    unavailableServer.listen(0, "127.0.0.1", () => {
      const address = unavailableServer.address();
      if (!address || typeof address === "string") return reject(new Error("missing owned unavailable loopback endpoint"));
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function closeUnavailableEndpoint() {
  if (!unavailableServer) return;
  await new Promise((resolve, reject) => unavailableServer.close((error) => error ? reject(error) : resolve()));
  unavailableServer = undefined;
}

try {
  const staged = await stageReleaseArtifact({ repoRoot, outputRoot });
  const coreArchive = staged.platformArchives.find((archive) => archive.platform === "win32");
  if (!coreArchive) throw new Error("missing Windows Core release archive");
  extractedCoreArchive = await extractPlatformReleaseArchive({ archivePath: coreArchive.archivePath, artifactName: staged.artifactName, platform: "win32" });
  const coreRoot = extractedCoreArchive.extractedRoot;
  const operatorTools = (await verifyRetainedOperatorTools({ artifactRoot: coreRoot })).manifest;
  const tui = operatorTools.tools.find((tool) => tool.command === "service-lasso-tui" && tool.status === "available");
  const asset = tui?.assets?.find((candidate) => candidate.platform === "win32-amd64");
  if (!asset || !/^[A-Za-z0-9._-]+\.zip$/u.test(asset.name)) throw new Error("missing exact Windows TUI archive in extracted Core artifact");
  await mkdir(tuiRoot, { recursive: true });
  await extractZipSafely(path.join(coreRoot, asset.relativePath), tuiRoot);
  const files = await readdir(tuiRoot, { recursive: true });
  const executable = files.find((file) => file === "service-lasso-tui.exe");
  if (!executable) throw new Error("Windows TUI archive did not contain its executable");
  const tuiExecutable = path.join(tuiRoot, executable);
  const unavailableUrl = await ownedLoopbackUnavailableEndpoint();
  const unavailableToken = randomBytes(32).toString("base64url");
  const safeProbe = parseConptyProbeResult((await runCommand("python", [helperPath, "--executable", tuiExecutable, "--mode", "unavailable", "--api-url", unavailableUrl, "--api-token", unavailableToken])).stdout, "unavailable");
  await closeUnavailableEndpoint();
  const connectedToken = randomBytes(32).toString("base64url");
  process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN = connectedToken;
  const core = await import(pathToFileURL(path.join(coreRoot, "packages", "core", "index.js")).href);
  apiServer = await core.startApiServer({ port: 0, servicesRoot: path.join(repoRoot, "services"), workspaceRoot: path.join(tempRoot, "workspace") });
  const connectedProbe = parseConptyProbeResult((await runCommand("python", [helperPath, "--executable", tuiExecutable, "--mode", "connected", "--api-url", apiServer.url, "--api-token", connectedToken])).stdout, "connected");
  console.log(JSON.stringify({ ok: true, evidence: "direct-conpty", platform: "win32-amd64", safeStartup: safeProbe.startup, connectedDashboard: connectedProbe.startup, navigation: connectedProbe.navigation, exit: connectedProbe.exit, artifact: staged.artifactName }));
} finally {
  await apiServer?.stop();
  await closeUnavailableEndpoint();
  if (previousLocalAdminToken === undefined) delete process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;
  else process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN = previousLocalAdminToken;
  await extractedCoreArchive?.cleanup();
  await rm(tempRoot, { recursive: true, force: true });
}
