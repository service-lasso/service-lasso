import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import net from "node:net";
import { EventEmitter, once } from "node:events";
import { checkHttpHealth } from "../dist/runtime/health/checkHttp.js";
import { checkTcpHealth } from "../dist/runtime/health/checkTcp.js";

test("HTTP healthchecks use configured per-attempt timeout", async () => {
  const probeServer = createServer((_, response) => {
    setTimeout(() => {
      response.statusCode = 200;
      response.end("ok");
    }, 150);
  });
  probeServer.listen(0, "127.0.0.1");
  await once(probeServer, "listening");
  const address = probeServer.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP probe server failed to bind.");
  }

  try {
    const health = await checkHttpHealth({
      type: "http",
      url: `http://127.0.0.1:${address.port}/health`,
      timeout: 25,
    });

    assert.equal(health.healthy, false);
    assert.equal(health.type, "http");
    assert.match(health.detail, /timed out after 25ms/i);
  } finally {
    probeServer.close();
    await once(probeServer, "close");
  }
});

test("TCP healthchecks use configured per-attempt timeout", async () => {
  const originalCreateConnection = net.createConnection;
  const createdSockets = [];

  net.createConnection = () => {
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.destroy = () => {
      socket.destroyed = true;
      return socket;
    };
    socket.end = () => socket;
    socket.setTimeout = (timeoutMs, callback) => {
      socket.timeoutMs = timeoutMs;
      setTimeout(callback, 0);
      return socket;
    };
    createdSockets.push(socket);
    return socket;
  };

  try {
    const health = await checkTcpHealth({
      type: "tcp",
      address: "127.0.0.1:43123",
      timeout: 35,
    });

    assert.equal(health.healthy, false);
    assert.equal(health.type, "tcp");
    assert.match(health.detail, /timed out after 35ms/i);
    assert.equal(createdSockets[0].timeoutMs, 35);
    assert.equal(createdSockets[0].destroyed, true);
  } finally {
    net.createConnection = originalCreateConnection;
  }
});
