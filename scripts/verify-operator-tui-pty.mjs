import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractPlatformReleaseArchive, runCommand, stageReleaseArtifact } from "./release-artifact-lib.mjs";
import { verifyRetainedOperatorTools } from "./operator-tool-packaging-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.platform.startsWith("linux") && process.platform !== "darwin") {
  console.log(JSON.stringify({ ok: true, classification: "not_applicable", reason: "PTY qualification is run on Linux and macOS only." }));
  process.exit(0);
}

const architecture = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : null;
if (!architecture) throw new Error(`unsupported TUI qualification architecture: ${process.arch}`);
const platform = process.platform === "darwin" ? `darwin-${architecture}` : "linux-amd64";
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-tui-pty-"));
const outputRoot = path.join(tempRoot, "artifacts");
const extractRoot = path.join(tempRoot, "tui");
let extractedCoreArchive;
const pythonProbe = path.join(tempRoot, "tui-pty-probe.py");
let apiServer;

try {
  const staged = await stageReleaseArtifact({ repoRoot, outputRoot });
  const coreArchive = staged.platformArchives.find((archive) => archive.platform === process.platform);
  if (!coreArchive) throw new Error(`missing ${process.platform} Core release archive`);
  extractedCoreArchive = await extractPlatformReleaseArchive({ archivePath: coreArchive.archivePath, artifactName: staged.artifactName, platform: process.platform });
  const extractedCoreRoot = extractedCoreArchive.extractedRoot;
  const verifiedOperatorTools = await verifyRetainedOperatorTools({ artifactRoot: extractedCoreRoot });
  const operatorTools = verifiedOperatorTools.manifest;
  const tui = operatorTools.tools.find((tool) => tool.command === "service-lasso-tui" && tool.status === "available");
  const asset = tui?.assets?.find((candidate) => candidate.platform === platform);
  if (!asset || !/^[A-Za-z0-9._-]+\.tar\.gz$/u.test(asset.name) || !/^[a-f0-9]{64}$/u.test(asset.sha256)) throw new Error(`missing exact ${platform} TUI archive in staged Core artifact`);
  const archivePath = path.join(extractedCoreRoot, asset.relativePath);
  await mkdir(extractRoot, { recursive: true });
  await runCommand("tar", ["-xzf", archivePath, "-C", extractRoot]);
  const files = await readdir(extractRoot, { recursive: true });
  const executable = files.find((entry) => entry === "service-lasso-tui");
  if (!executable) throw new Error("TUI archive did not contain its expected executable");
  const stagedCore = await import(pathToFileURL(path.join(extractedCoreRoot, "packages", "core", "index.js")).href);
  apiServer = await stagedCore.startApiServer({
    port: 0,
    servicesRoot: path.join(repoRoot, "services"),
    workspaceRoot: path.join(tempRoot, "workspace"),
  });

  await writeFile(pythonProbe, `
import json, os, pty, select, signal, sys, time
exe = sys.argv[1]
api_url = sys.argv[3]
def run_case(name, connected):
    pid, fd = pty.fork()
    if pid == 0:
        env = {"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", "")}
        if connected: env["SERVICE_LASSO_API_URL"] = api_url
        os.execve(exe, [exe], env)
    status = None
    reaped = False
    primary_error = None
    buffer = b""
    def read_until(needles, timeout):
        nonlocal buffer
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            ready, _, _ = select.select([fd], [], [], min(0.25, deadline - time.monotonic()))
            if ready:
                try: chunk = os.read(fd, 4096)
                except OSError: break
                buffer = (buffer + chunk)[-65536:]
                if all(needle in buffer for needle in needles): return True
        return False
    try:
        required = [b"Service Lasso TUI", b"q quit"]
        required.append(b"Runtime identity:" if connected else b"Runtime API unavailable")
        if not read_until(required, 20): raise RuntimeError(name + " startup state was not rendered")
        if connected and b"Runtime API unavailable" in buffer: raise RuntimeError("connected Core dashboard rendered an unavailable state")
        os.write(fd, b"d")
        os.write(fd, b"?")
        if not read_until([b"d dashboard", b"esc back"], 5): raise RuntimeError(name + " keyboard navigation did not render help")
        os.write(fd, b"q")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            waited, value = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                status = value
                reaped = True
                break
            time.sleep(0.05)
        if status is None:
            raise RuntimeError(name + " q did not exit within the bounded terminal window")
        if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0: raise RuntimeError(name + " did not exit cleanly")
    except BaseException as error:
        primary_error = error
        raise
    finally:
        cleanup_error = None
        try:
            if not reaped:
                try:
                    waited, value = os.waitpid(pid, os.WNOHANG)
                    if waited != pid:
                        os.kill(pid, signal.SIGKILL)
                        waited, value = os.waitpid(pid, 0)
                    if waited != pid: raise RuntimeError("owned PTY child was not reaped")
                    status = value
                    reaped = True
                except BaseException as error:
                    cleanup_error = error
        finally:
            try: os.close(fd)
            except OSError as error:
                if cleanup_error is None: cleanup_error = error
        if cleanup_error is not None:
            if primary_error is None: raise RuntimeError("owned PTY cleanup failed") from cleanup_error
            try: print("owned PTY cleanup failed", file=sys.stderr)
            except OSError: pass
run_case("safe_unavailable", False)
run_case("connected_dashboard", True)
print(json.dumps({"ok": True, "platform": sys.argv[2], "safeStartup": "unavailable", "connectedDashboard": "rendered", "navigation": "help", "exit": "q"}))
`, "utf8");
  const probe = await runCommand("python3", [pythonProbe, path.join(extractRoot, executable), platform, apiServer.url]);
  const result = JSON.parse(probe.stdout.trim());
  if (!result?.ok) throw new Error("PTY probe did not report success");
  console.log(JSON.stringify({ ...result, evidence: "direct-pty", artifact: staged.artifactName }));
} finally {
  await apiServer?.stop();
  await extractedCoreArchive?.cleanup();
  await rm(tempRoot, { recursive: true, force: true });
}
