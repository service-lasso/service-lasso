import { createServer } from "node:net";
import { randomBytes } from "node:crypto";

// Private attempt channel. No target stdout, parent PID alone, cancellation
// acknowledgment or socket loss is a terminal containment observation.
export async function createConptyNativeContainment() {
  const token = randomBytes(32).toString("hex");
  const pipe = `\\\\.\\pipe\\service-lasso-conpty-${randomBytes(32).toString("hex")}`;
  let socket, nativePid, registered = false, terminalSeen = false, invalid = false, cancelled = false;
  let resolveTerminal;
  const terminal = new Promise((resolve) => { resolveTerminal = resolve; });
  const server = createServer((peer) => {
    if (socket || invalid) { peer.destroy(); invalid = true; return; }
    socket = peer;
    let buffered = "";
    peer.setEncoding("ascii");
    peer.on("error", () => { invalid = true; });
    peer.on("data", (chunk) => {
      if (invalid || terminalSeen || buffered.length + chunk.length > 256 || /[^\x20-\x7e\n]/u.test(chunk)) { invalid = true; return; }
      buffered += chunk;
      const end = buffered.indexOf("\n");
      if (end < 0) return;
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      const match = /^(registered|terminal):([a-f0-9]{64}):([1-9][0-9]*):(0|[1-9][0-9]*):0$/u.exec(line);
      if (!match || match[2] !== token || Number(match[3]) !== nativePid || !Number.isSafeInteger(Number(match[4])) || Number(match[4]) > 0xffff_ffff || buffered.length) { invalid = true; return; }
      if (!registered) {
        if (match[1] !== "registered" || match[4] !== "0") { invalid = true; return; }
        registered = true;
        peer.write(`resume:${token}\n`);
        if (cancelled) peer.write(`cancel:${token}\n`);
      } else {
        if (match[1] !== "terminal") { invalid = true; return; }
        terminalSeen = true;
        resolveTerminal({ code: Number(match[4]), activeProcesses: 0, nativePid });
      }
    });
    peer.on("close", () => { if (!terminalSeen) invalid = true; });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(pipe, resolve); });
  server.on("error", () => { invalid = true; });
  return {
    environment: {
      SERVICE_LASSO_CONPTY_CONTROL_PIPE: pipe,
      SERVICE_LASSO_CONPTY_CONTROL_TOKEN: token,
      SERVICE_LASSO_CONPTY_CONTROL_OWNER: String(process.pid),
    },
    bindChild(child) { nativePid = child.pid; if (!Number.isSafeInteger(nativePid) || nativePid < 1) invalid = true; },
    requestCancellation() { cancelled = true; if (registered && !terminalSeen && !invalid) socket.write(`cancel:${token}\n`); },
    terminal,
    async cleanup() { socket?.destroy(); await new Promise((resolve) => server.close(resolve)); },
  };
}
