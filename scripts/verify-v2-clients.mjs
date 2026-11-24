import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startApiServer } from "../dist/server/index.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tuiRoot = process.env.SERVICE_LASSO_TUI_ROOT ?? path.resolve(root, "../service-lasso-tui");
const cliRoot = process.env.SERVICE_LASSO_CLI_ROOT ?? path.resolve(root, "../service-lasso-cli");
const go = process.env.GO ?? "go";
const execFileAsync = promisify(execFile);
const temp = await mkdtemp(path.join(os.tmpdir(), "service-lasso-v2-clients-"));
const servicesRoot = path.join(temp, "services");
const workspaceRoot = path.join(temp, "workspace");
const probe = path.join(temp, "service-lasso-operator-probe");
await mkdir(servicesRoot);
await mkdir(workspaceRoot);

let server;
try {
  execFileSync(go, ["build", "-o", probe, "./cmd/service-lasso-operator-probe"], { cwd: tuiRoot, stdio: "pipe" });
  server = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
  const cli = path.join(cliRoot, "dist/index.js");
  const cliDiscovery = JSON.parse((await execFileAsync(process.execPath, [cli, "--core-url", server.url, "operator", "discovery", "--json"], { encoding: "utf8" })).stdout);
  if (cliDiscovery.mutationSemantics !== "unavailable") {
    throw new Error("CLI did not read Core operator/v2 discovery");
  }
  const cliServices = JSON.parse((await execFileAsync(process.execPath, [cli, "--core-url", server.url, "operator", "services", "--json"], { encoding: "utf8" })).stdout);
  if (!Array.isArray(cliServices.rows) || cliServices.rows.length !== 0) {
    throw new Error("CLI did not read the Core operator/v2 service page");
  }
  const tuiOutput = (await execFileAsync(probe, [server.url], { encoding: "utf8" })).stdout.trim();
  const expected = `${cliDiscovery.metadataRevision} 0 true`;
  if (tuiOutput !== expected) throw new Error(`TUI v2 probe mismatch: ${tuiOutput} != ${expected}`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    core: server.url,
    discovery: cliDiscovery.metadataRevision,
    services: 0,
    tui: tuiOutput,
  })}\n`);
} finally {
  await server?.stop().catch(() => undefined);
  await rm(temp, { recursive: true, force: true });
}
