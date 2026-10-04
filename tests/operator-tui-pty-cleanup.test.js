import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// SPEC-008 R6/R7: execute the exact source-owned generated Python run_case;
// observe its real fork/kill/wait/close against an isolated fixture executable.
// This proves probe cleanup only, never native released TUI acceptance.
// Prospective source cases remain UNEXECUTED until new review/ROOT admission.
const harness = String.raw`
import json, os, pathlib, pty, signal, sys, time
source = pathlib.Path(sys.argv[1]).read_text()
scenario = sys.argv[2]
prefix = source[:source.index('run_case("safe_unavailable", False)')]
namespace = {"__name__": "actual_source_probe"}
exec(prefix, namespace)
exe = pathlib.Path(sys.argv[3])
if scenario == "startup":
    payload = 'import time\nprint("deliberately missing startup state", flush=True)\ntime.sleep(60)\n'
else:
    payload = 'import os, time, tty\ntty.setraw(0)\nprint("Service Lasso TUI q quit Runtime identity:", flush=True)\n'
    if scenario in ("quit", "clean"):
        payload += 'while True:\n    key = os.read(0, 1)\n    if key == b"?": print("d dashboard esc back", flush=True)\n    if key == b"q" and ' + repr(scenario == "clean") + ': break\n'
    else:
        payload += 'time.sleep(60)\n'
exe.write_text('#!' + sys.executable + '\n' + payload)
exe.chmod(0o700)
namespace["exe"] = str(exe)
namespace["api_url"] = "http://127.0.0.1:1"
original_fork, original_kill = pty.fork, os.kill
original_wait, original_close = os.waitpid, os.close
owner, kills, reaps, closes, waits = {}, [], [], [], []
def fork():
    pid, fd = original_fork()
    if pid != 0: owner.update(pid=pid, fd=fd)
    return pid, fd
def kill(pid, sig):
    kills.append([pid, sig])
    return original_kill(pid, sig)
def waitpid(pid, flags):
    waits.append([pid, flags])
    waited, status = original_wait(pid, flags)
    if waited == pid: reaps.append([pid, status])
    return waited, status
def close(fd):
    owned = fd == owner.get("fd")
    if owned: closes.append(fd)
    result = original_close(fd)
    if owned and scenario == "help-close-error": raise OSError("fixture close observation failure")
    return result
pty.fork, os.kill, os.waitpid, os.close = fork, kill, waitpid, close
error = None
try:
    namespace["run_case"]("fixture_" + scenario, True)
except BaseException as caught:
    error = caught
finally:
    # Fixture-owned fallback after collecting observations, not probe evidence.
    # It keeps a regression from leaving a child/descriptor in the test host.
    observed = {"owner": dict(owner), "kills": list(kills), "reaps": list(reaps), "closes": list(closes), "waits": list(waits)}
    if "pid" in owner:
        try:
            waited, _ = original_wait(owner["pid"], os.WNOHANG)
            if waited != owner["pid"]:
                original_kill(owner["pid"], signal.SIGKILL)
                original_wait(owner["pid"], 0)
        except (ChildProcessError, OSError): pass
    if "fd" in owner:
        try: original_close(owner["fd"])
        except OSError: pass
if scenario == "clean":
    assert error is None, str(error)
    assert observed["kills"] == [], observed
else:
    assert type(error) is RuntimeError, type(error).__name__ if error else "missing primary failure"
    trace = error.__traceback__
    while trace and trace.tb_frame.f_code.co_name != "run_case": trace = trace.tb_next
    assert trace and trace.tb_frame.f_locals["primary_error"] is error, "cleanup replaced the original exception object"
    expected = " startup state was not rendered" if scenario == "startup" else " q did not exit within the bounded terminal window" if scenario == "quit" else " keyboard navigation did not render help"
    assert str(error) == "fixture_" + scenario + expected, str(error)
    assert observed["kills"] == [[owner["pid"], signal.SIGKILL]], observed
assert len(observed["reaps"]) == 1 and observed["reaps"][0][0] == owner["pid"], observed
if scenario == "clean":
    assert os.WIFEXITED(observed["reaps"][0][1]) and os.WEXITSTATUS(observed["reaps"][0][1]) == 0, observed
else:
    assert os.WIFSIGNALED(observed["reaps"][0][1]) and os.WTERMSIG(observed["reaps"][0][1]) == signal.SIGKILL, observed
assert all(pid == owner["pid"] for pid, flags in observed["waits"]), observed
# A natural q exit must never re-enter child cleanup after its terminal witness.
if scenario == "clean": assert observed["waits"][-1][1] == os.WNOHANG, observed
assert observed["closes"] == [owner["fd"]], observed
try: original_wait(owner["pid"], os.WNOHANG)
except ChildProcessError: pass
else: raise AssertionError("probe did not reap the exact child")
try: os.fstat(owner["fd"])
except OSError: pass
else: raise AssertionError("probe did not close the exact PTY")
print(json.dumps({"primary": str(error) if error else None, "killed": scenario != "clean", "reaped": True, "closed": True}))
`;

for (const script of ["verify-operator-tui-pty.mjs", "verify-operator-tui-pty-scoped.mjs"]) {
  for (const scenario of ["startup", "help", "quit", "clean", "help-close-error"]) {
    test(`${script} preserves ${scenario} failure while reaping its exact PTY child`, { skip: process.platform === "win32" ? "POSIX PTY probe; Windows uses the separate ConPTY acceptance route" : false }, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "lasso-tui-pty-cleanup-"));
      try {
        const source = await readFile(new URL(`../scripts/${script}`, import.meta.url), "utf8");
        const marker = /\r?\nimport json, os, pty, select, signal, sys, time\r?\n/u.exec(source);
        const start = marker?.index ?? -1;
        const endMarker = /\r?\n`, "utf8"\);/u.exec(source.slice(start + (marker?.[0].length ?? 0)));
        const end = endMarker ? start + marker[0].length + endMarker.index : -1;
        assert.ok(start >= 0 && end > start, "retain the actual full generated Python probe");
        const probePath = path.join(root, "actual-probe.py");
        const harnessPath = path.join(root, "harness.py");
        const executablePath = path.join(root, "fixture-tui");
        await writeFile(probePath, source.slice(start + (source[start] === "\r" ? 2 : 1), end));
        await writeFile(harnessPath, harness);
        const result = await execFileAsync("python3", [harnessPath, probePath, scenario, executablePath], { timeout: 35_000, maxBuffer: 128 * 1024, windowsHide: true });
        const failure = scenario === "startup" ? " startup state was not rendered" : scenario === "quit" ? " q did not exit within the bounded terminal window" : " keyboard navigation did not render help";
        assert.deepEqual(JSON.parse(result.stdout.trim()), { primary: scenario === "clean" ? null : `fixture_${scenario}${failure}`, killed: scenario !== "clean", reaped: true, closed: true });
        assert.equal(result.stderr.trim(), scenario === "help-close-error" ? "owned PTY cleanup failed" : "");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}
