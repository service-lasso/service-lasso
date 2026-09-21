import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { x as extract } from "tar";
import { stagePublishedPackage } from "./publish-package-lib.mjs";
import { runCommand } from "./release-artifact-lib.mjs";

export async function runAppNpm(args, options) {
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); } catch { continue; }
    return runCommand(process.execPath, [candidate, ...args], options);
  }
  throw new Error("Cannot locate npm CLI. Run the proof through npm run verify:newcomer-proof.");
}

export function appJourneyEnvironment(start, env = process.env) {
  if (!Number.isInteger(start) || start < 1024 || start + 59 > 65535) throw new Error("Invalid app proof port range.");
  return { ...env, LASSO_EXAMPLE_CORE_PORT: String(start), LASSO_EXAMPLE_DATABASE_PORT: String(start + 1), LASSO_EXAMPLE_APP_PORT: String(start + 2), SERVICE_LASSO_PORT_RANGE_START: String(start), SERVICE_LASSO_PORT_RANGE_END: String(start + 59) };
}

async function digest(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

// All files are retained under the newly claimed proof root. Raw command output
// stays private; only explicitly selected identities/results reach the ZIP.
export async function prepareAppJourney({ repoRoot, proofRoot, portStart }) {
  const privateRoot = path.join(proofRoot, "private-app-journey");
  await mkdir(privateRoot); // Never replace a previous run.
  const env = appJourneyEnvironment(portStart);
  const staged = await stagePublishedPackage({ repoRoot, outputRoot: path.join(privateRoot, "candidate") });
  const packed = await runAppNpm(["pack", "--json", "--pack-destination", privateRoot], { cwd: path.join(repoRoot, "examples", "postgres-app"), windowsHide: true });
  const pack = JSON.parse(packed.stdout)[0];
  const archive = path.join(privateRoot, pack.filename);
  if (pack.files.some(({ path: name }) => !/^(?:[^/]+\.mjs|README\.md|package\.json|npm-shrinkwrap\.json)$/.test(name))) throw new Error("Unexpected source-package file; refusing to use the archive.");
  await extract({ file: archive, cwd: privateRoot, strict: true });
  const cwd = path.join(privateRoot, "package");
  const commands = [];
  const execute = async (label, callback) => {
    try {
      const result = await callback();
      await writeFile(path.join(privateRoot, `${label}.json`), JSON.stringify(result));
      commands.push({ command: label, result: "Verified" });
    } catch (error) {
      await writeFile(path.join(privateRoot, `${label}.json`), JSON.stringify({ message: String(error) }));
      throw new Error(`App journey command failed: ${label}`);
    }
  };
  await execute("npm-ci", () => runAppNpm(["ci", "--ignore-scripts"], { cwd, env, windowsHide: true }));
  // Explicit test-only substitution, not a claim that the example's published
  // shrinkwrap already references this source candidate.
  await execute("install-current-candidate", () => runAppNpm(["install", "--no-save", "--package-lock=false", "--ignore-scripts", staged.packageArchivePath], { cwd, env, windowsHide: true }));
  const installed = JSON.parse(await readFile(path.join(cwd, "node_modules/@service-lasso/service-lasso/package.json"), "utf8"));
  if (installed.version !== staged.manifest.version) throw new Error("Installed app Core candidate version mismatch.");
  await execute("setup", () => runCommand(process.execPath, ["setup.mjs"], { cwd, env, windowsHide: true }));
  let output = "";
  const child = spawn(process.execPath, ["app.mjs"], { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  let spawnError;
  child.on("error", error => { spawnError = error; });
  const closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  const apiUrl = `http://127.0.0.1:${portStart}`;
  const appUrl = `http://127.0.0.1:${portStart + 2}`;
  const cleanup = async () => {
    try {
      await execute("stop", () => runCommand(process.execPath, ["stop.mjs"], { cwd, env, windowsHide: true, timeout: 60_000 }));
      const result = await Promise.race([closed, new Promise(resolve => { const timer = setTimeout(() => resolve(null), 15_000); timer.unref(); })]);
      if (!result || result.code !== 0) throw new Error("Owned app process did not exit successfully after stop.");
      return { status: "Verified" };
    } finally {
      await writeFile(path.join(privateRoot, "runtime-output.txt"), output);
    }
  };
  try {
    let ready = false;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null) throw new Error("Owned app exited before readiness.");
      try {
        const response = await fetch(appUrl, { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.json()).database === "connected") { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("Owned app readiness timed out.");
    await execute("check", () => runCommand(process.execPath, ["check.mjs"], { cwd, env, windowsHide: true }));
    return { apiUrl, appUrl, cleanup, receipt: { sourcePackage: { sha256: await digest(archive), files: pack.files.map(file => file.path) }, corePackage: { version: installed.version, sha256: await digest(staged.packageArchivePath), substitution: "locally staged current candidate replaces pinned example dependency" }, commands } };
  } catch (error) {
    await writeFile(path.join(privateRoot, "journey-failure.json"), JSON.stringify({ message: String(error) }));
    try { await cleanup(); } catch (cleanupError) {
      await writeFile(path.join(privateRoot, "cleanup-failure.json"), JSON.stringify({ message: String(cleanupError) }));
    }
    throw error;
  }
}
