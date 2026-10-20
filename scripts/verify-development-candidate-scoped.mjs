import { assertDevelopIdentity, assertPolicyEnvironment, readSourceScope } from "./ga-platform-scope-lib.mjs";
import { readVerifiedDevelopmentCandidate } from "./verify-development-candidate-artifact-scoped.mjs";
import { extractScopedCoreArchive } from "./scoped-core-archive-lib.mjs";
import { verifyRetainedOperatorTools } from "./operator-tool-packaging-lib.mjs";
assertDevelopIdentity(); assertPolicyEnvironment(); await readSourceScope();
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.env.DEVELOPMENT_CANDIDATE_ROOT ?? "");
const candidateSha = process.env.CANDIDATE_SHA?.trim().toLowerCase();
const platform = process.env.DEVELOPMENT_CANDIDATE_PLATFORM?.trim();
if (!root || !/^[a-f0-9]{40}$/u.test(candidateSha ?? "") || !["win32", "linux"].includes(platform)) {
  throw new Error("Candidate root, full SHA, and supported platform are required.");
}
if (platform !== process.platform || process.arch !== "x64") throw new Error("Scoped candidate native host platform/architecture differs");

// Provider identity, original ZIP members and downloaded buffers are bound in
// this process before semantic parsing. Extraction below uses the same held body.
const { held, manifest } = await readVerifiedDevelopmentCandidate(root);
// The provider credential must not reach native extraction or the candidate Core.
delete process.env.GH_TOKEN;
const archive = manifest.archives.find((entry) => entry.platform === platform && entry.artifact === "unbundled");
if (!archive) throw new Error("Candidate lacks the requested unbundled platform archive.");
const artifactName = archive.name.replace(platform === "win32" ? /-win32\.zip$/u : new RegExp(`-${platform}\\.tar\\.gz$`, "u"), "");
const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-development-candidate-"));
const extractionRoot = path.join(workspaceRoot, "extracted");
await mkdir(extractionRoot, { recursive: true });
await extractScopedCoreArchive(held.get(archive.name), extractionRoot, platform, artifactName, archive.sha256);
const extractedRoot = path.join(extractionRoot, artifactName);
if (!(await stat(extractedRoot)).isDirectory()) throw new Error("Candidate archive did not contain its expected package root.");
if ((await verifyRetainedOperatorTools({ artifactRoot: extractedRoot, requireProtected: true })).manifest.schemaVersion !== "service-lasso.operator-tools.v3") throw new Error("Scoped candidate consumer requires source-approved operator3 original bytes");
const servicesRoot = path.join(workspaceRoot, "services");
await mkdir(servicesRoot, { recursive: true });
const port = 19000 + Math.floor(Math.random() * 1000);
const child = (await import("node:child_process")).spawn(process.execPath, [path.join(extractedRoot, "dist", "index.js"), "--noautostart"], {
  cwd: extractedRoot,
  env: { ...process.env, SERVICE_LASSO_PORT: String(port), SERVICE_LASSO_SERVICES_ROOT: servicesRoot, SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot },
  stdio: ["ignore", "ignore", "pipe"],
});
let childExited = false;
const childExit = new Promise((resolve) => child.once("exit", () => { childExited = true; resolve(); }));
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Candidate Core did not become healthy within 60 seconds.")), 60_000);
    const probe = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        const health = await response.json();
        if (response.ok && health?.api?.version) { clearTimeout(timer); resolve(health); return; }
      } catch {}
      setTimeout(probe, 250);
    };
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Candidate Core exited before health with code ${code}.`)));
    void probe();
  });
  await stat(path.join(extractedRoot, "packages", "core", "cli.js"));
  process.stdout.write(`${JSON.stringify({ candidateSha, platform, consumerSmoke: "passed" })}\n`);
} finally {
  if (!childExited) {
    child.kill("SIGTERM");
    await Promise.race([childExit, new Promise((_, reject) => setTimeout(() => reject(new Error("Owned candidate Core did not exit before cleanup.")), 15_000))]);
  }
  await rm(workspaceRoot, { recursive: true, force: true });
}
