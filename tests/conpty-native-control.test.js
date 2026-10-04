import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createConptyNativeContainment } from "../scripts/conpty-native-containment.mjs";

// Executes the actual closed consumer; transport/event scheduling is controlled
// and never supplies a native Job-zero or operator acceptance claim.
for (const mode of ["unavailable", "connected"]) {
  for (const scenario of ["orderly", "delayed extra", "duplicate", "error", "lost", "second peer"]) {
    test(`private ConPTY ${mode} terminal finalization: ${scenario}`, async () => {
      let accept;
      const server = new EventEmitter();
      server.listen = (_path, ready) => ready();
      server.close = (closed) => { closed(); };
      const channel = await createConptyNativeContainment({ serverFactory: (onConnection) => { accept = onConnection; return server; } });
      const child = new EventEmitter(); child.pid = 1337;
      channel.bindChild(child);
      const peer = new EventEmitter(); const commands = [];
      peer.write = (line) => { commands.push(line); return true; }; peer.destroy = () => {};
      accept(peer);
      const token = channel.environment.SERVICE_LASSO_CONPTY_CONTROL_TOKEN;
      peer.emit("data", Buffer.from(`registered:${token}:1337:0:0\n`));
      assert.deepEqual(commands, [`resume:${token}\n`]);
      let settled = false;
      const result = channel.finalizeAfterChildClose().then((terminal) => { settled = true; return terminal; });
      if (scenario === "lost") peer.emit("data", Buffer.from(`terminal:${token}:1337:`));
      else peer.emit("data", Buffer.from(`terminal:${token}:1337:0:0\n`));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false, "parsed terminal is only provisional");
      if (scenario === "delayed extra") peer.emit("data", Buffer.from("x"));
      if (scenario === "duplicate") peer.emit("data", Buffer.from(`terminal:${token}:1337:0:0\n`));
      if (scenario === "error") peer.emit("error", new Error("private fixture channel failure"));
      if (scenario === "second peer") { const other = new EventEmitter(); other.destroy = () => {}; accept(other); }
      peer.emit("close", scenario === "error");
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false, "control close alone is not original child/stream close");
      child.emit("close", 0, null);
      await new Promise((resolve) => setImmediate(resolve));
      if (scenario === "orderly") assert.deepEqual(await result, { code: 0, activeProcesses: 0, nativePid: 1337 });
      else assert.equal(settled, false, "invalid attempt remains unresolved; no cleanup authority");
      await channel.cleanup();
    });
  }
}
