import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand, stageReleaseArtifact } from "./release-artifact-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.platform.startsWith("linux") && process.platform !== "darwin") {
  console.log(JSON.stringify({ ok: true, classification: "not_applicable", reason: "PTY qualification is run on Linux and macOS only." }));
  process.exit(0);
}

const platform = process.platform === "darwin" ? "darwin-amd64" : "linux-amd64";
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-tui-pty-"));
const outputRoot = path.join(tempRoot, "artifacts");
const extractRoot = path.join(tempRoot, "tui");
const pythonProbe = path.join(tempRoot, "tui-pty-probe.py");

try {
  const staged = await stageReleaseArtifact({ repoRoot, outputRoot });
  const operatorTools = JSON.parse(await readFile(path.join(staged.artifactRoot, "operator-tools", "manifest.json"), "utf8"));
  const tui = operatorTools.tools.find((tool) => tool.command === "service-lasso-tui" && tool.status === "available");
  const asset = tui?.assets?.find((candidate) => candidate.platform === platform);
  if (!asset || !/^[A-Za-z0-9._-]+\.tar\.gz$/u.test(asset.name) || !/^[a-f0-9]{64}$/u.test(asset.sha256)) throw new Error(`missing exact ${platform} TUI archive in staged Core artifact`);
  const archivePath = path.join(staged.artifactRoot, asset.relativePath);
  await mkdir(extractRoot, { recursive: true });
  await runCommand("tar", ["-xzf", archivePath, "-C", extractRoot]);
  const files = await readdir(extractRoot, { recursive: true });
  const executable = files.find((entry) => entry === "service-lasso-tui");
  if (!executable) throw new Error("TUI archive did not contain its expected executable");

  await writeFile(pythonProbe, `
import json, os, pty, select, signal, sys, time
exe = sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.execve(exe, [exe], {"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", "")})
buffer = b""
def read_until(needles, timeout):
    global buffer
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], min(0.25, deadline - time.monotonic()))
        if ready:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                break
            buffer = (buffer + chunk)[-65536:]
            if all(needle in buffer for needle in needles):
                return True
    return False
try:
    if not read_until([b"Service Lasso TUI", b"Runtime API unavailable", b"q quit"], 20):
        raise RuntimeError("startup or safe unavailable state was not rendered")
    os.write(fd, b"d")
    os.write(fd, b"?")
    if not read_until([b"d dashboard", b"esc back"], 5):
        raise RuntimeError("keyboard navigation did not render help")
    os.write(fd, b"q")
    deadline = time.monotonic() + 5
    status = None
    while time.monotonic() < deadline:
        waited, value = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            status = value
            break
        time.sleep(0.05)
    if status is None:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        raise RuntimeError("q did not exit within the bounded terminal window")
    if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
        raise RuntimeError("TUI did not exit cleanly")
    print(json.dumps({"ok": True, "platform": sys.argv[2], "startup": "safe_unavailable", "navigation": "help", "exit": "q"}))
finally:
    try: os.close(fd)
    except OSError: pass
`, "utf8");
  const probe = await runCommand("python3", [pythonProbe, path.join(extractRoot, executable), platform]);
  const result = JSON.parse(probe.stdout.trim());
  if (!result?.ok) throw new Error("PTY probe did not report success");
  console.log(JSON.stringify({ ...result, evidence: "direct-pty", artifact: staged.artifactName }));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
