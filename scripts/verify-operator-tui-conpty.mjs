import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractZipSafely } from "../dist/runtime/files/safe-zip.js";
import { extractPlatformReleaseArchive, stageReleaseArtifact } from "./release-artifact-lib.mjs";
import { verifyRetainedOperatorTools } from "./operator-tool-packaging-lib.mjs";
import { runConptyHelper } from "./operator-tui-conpty-runner.mjs";
import { createOwnedUnavailableEndpoint } from "./operator-tui-conpty-endpoint.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32") {
  console.log(JSON.stringify({ ok: true, classification: "not_applicable" }));
  process.exit(0);
}
if (process.arch !== "x64") throw new Error("Windows ConPTY qualification supports only win32-amd64.");

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-tui-conpty-"));
const outputRoot = path.join(tempRoot, "artifacts");
const tuiRoot = path.join(tempRoot, "tui");
const helperPath = path.join(repoRoot, "scripts", "verify-operator-tui-conpty.py");
let extractedCoreArchive;
let apiServer;
let unavailableEndpoint;
const previousLocalAdminToken = process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;

function ownedLoopbackUnavailableEndpoint() {
  return createOwnedUnavailableEndpoint().then((endpoint) => {
    unavailableEndpoint = endpoint;
    return endpoint.url;
  });
}

async function closeUnavailableEndpoint() {
  const endpoint = unavailableEndpoint;
  unavailableEndpoint = undefined;
  await endpoint?.close();
}

let primaryFailure;
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
  const safeProbe = await runConptyHelper({ helperPath, executable: tuiExecutable, mode: "unavailable", apiUrl: unavailableUrl, apiToken: unavailableToken });
  await closeUnavailableEndpoint();
  const connectedToken = randomBytes(32).toString("base64url");
  process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN = connectedToken;
  const core = await import(pathToFileURL(path.join(coreRoot, "packages", "core", "index.js")).href);
  apiServer = await core.startApiServer({ port: 0, servicesRoot: path.join(repoRoot, "services"), workspaceRoot: path.join(tempRoot, "workspace") });
  const connectedProbe = await runConptyHelper({ helperPath, executable: tuiExecutable, mode: "connected", apiUrl: apiServer.url, apiToken: connectedToken });
  console.log(JSON.stringify({ ok: true, evidence: "direct-conpty", platform: "win32-amd64", safeStartup: safeProbe.startup, connectedDashboard: connectedProbe.startup, navigation: connectedProbe.navigation, exit: connectedProbe.exit, artifact: staged.artifactName }));
} catch (error) {
  primaryFailure = error;
  throw error;
} finally {
  const cleanupFailures = [];
  for (const cleanup of [
    () => apiServer?.stop(),
    () => closeUnavailableEndpoint(),
    () => extractedCoreArchive?.cleanup(),
    () => rm(tempRoot, { recursive: true, force: true }),
    () => {
      if (previousLocalAdminToken === undefined) delete process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;
      else process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN = previousLocalAdminToken;
    },
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (cleanupFailures.length && !primaryFailure) throw new AggregateError(cleanupFailures, "Windows ConPTY qualification cleanup failed.");
}
