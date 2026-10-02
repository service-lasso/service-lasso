import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractZipSafely } from "../dist/runtime/files/safe-zip.js";
import { extractPlatformReleaseArchive, runCommand, stageReleaseArtifact } from "./release-artifact-lib.mjs";
import { verifyRetainedOperatorTools } from "./operator-tool-packaging-lib.mjs";

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

async function startUnavailableEndpoint() {
  const server = createServer((_request, response) => {
    response.statusCode = 503;
    response.end();
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("controlled unavailable endpoint did not bind a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function safeProbeResult(stdout) {
  try {
    const result = JSON.parse(stdout.trim());
    if (result?.ok === true && result.safeStartup === "unavailable" && result.connectedDashboard === "rendered" && result.navigation === "help" && result.exit === "q") return result;
  } catch { /* Helper output is intentionally not surfaced. */ }
  throw new Error("Windows ConPTY TUI probe did not complete its bounded assertions.");
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
  unavailableEndpoint = await startUnavailableEndpoint();
  const safeProbe = safeProbeResult((await runCommand("python", [helperPath, "--executable", tuiExecutable, "--mode", "unavailable", "--api-url", unavailableEndpoint.url])).stdout);
  await unavailableEndpoint.stop();
  unavailableEndpoint = undefined;
  const core = await import(pathToFileURL(path.join(coreRoot, "packages", "core", "index.js")).href);
  apiServer = await core.startApiServer({ port: 0, servicesRoot: path.join(repoRoot, "services"), workspaceRoot: path.join(tempRoot, "workspace") });
  const connectedProbe = safeProbeResult((await runCommand("python", [helperPath, "--executable", tuiExecutable, "--mode", "connected", "--api-url", apiServer.url])).stdout);
  console.log(JSON.stringify({ ok: true, evidence: "direct-conpty", platform: "win32-amd64", safeStartup: safeProbe.safeStartup, connectedDashboard: connectedProbe.connectedDashboard, navigation: connectedProbe.navigation, exit: connectedProbe.exit, artifact: staged.artifactName }));
} catch (error) {
  primaryFailure = error;
  throw error;
} finally {
  const cleanupFailures = [];
  for (const cleanup of [
    () => unavailableEndpoint?.stop(),
    () => apiServer?.stop(),
    () => extractedCoreArchive?.cleanup(),
    () => rm(tempRoot, { recursive: true, force: true }),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (cleanupFailures.length && !primaryFailure) throw new AggregateError(cleanupFailures, "Windows ConPTY qualification cleanup failed.");
}
