import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";

const serviceId = "node-sample-service";
const startedAt = new Date().toISOString();
const requestedPort = Number.parseInt(process.env.NODE_SAMPLE_PORT ?? process.env.SERVICE_PORT ?? "4020", 10);
const port = Number.isFinite(requestedPort) && requestedPort >= 0 ? requestedPort : 4020;
const heartbeatMs = Math.max(1_000, Number.parseInt(process.env.NODE_SAMPLE_HEARTBEAT_MS ?? "5000", 10) || 5000);
const counters = { heartbeat: 0, stdout: 0, stderr: 0, commands: 0 };

let server;
let heartbeat;
let shuttingDown = false;

function sanitizeMessage(value) {
  const fallback = "sample validation event";
  const text = typeof value === "string" && value.trim().length > 0 ? value : fallback;
  const stripped = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return (stripped || fallback).slice(0, 120);
}

function emitStdout(message) {
  counters.stdout += 1;
  console.log(`${serviceId} ${message}`);
  void writeProviderEnvSnapshot();
}

function emitStderr(message) {
  counters.stderr += 1;
  console.error(`${serviceId} ${message}`);
  void writeProviderEnvSnapshot();
}

async function writeProviderEnvSnapshot() {
  const targetPath = path.resolve(process.cwd(), process.env.NODE_SAMPLE_ENV_PATH ?? "./.state/provider-env.json");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    JSON.stringify(
      {
        NODE_ENV: process.env.NODE_ENV ?? null,
        SERVICE_PORT: process.env.SERVICE_PORT ?? null,
        NODE_SAMPLE_PORT: process.env.NODE_SAMPLE_PORT ?? null,
        pid: process.pid,
        port: server?.address() && typeof server.address() === "object" ? server.address().port : port,
        startedAt,
        outputCounters: counters,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function getRequestMessage(url) {
  return sanitizeMessage(url.searchParams.get("message"));
}

function handleRequest(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (request.method === "GET" && url.pathname === "/") {
    sendJson(response, 200, { serviceId, status: "running", startedAt, rawMaterialReturned: false });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      serviceId,
      uptimeMs: Math.max(0, Math.round(process.uptime() * 1000)),
      rawMaterialReturned: false,
    });
    return;
  }

  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/demo/log") {
    const message = getRequestMessage(url);
    emitStdout(`demo log message="${message}"`);
    sendJson(response, 200, { ok: true, emitted: true, stream: "stdout", message, rawMaterialReturned: false });
    return;
  }

  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/demo/error") {
    const message = getRequestMessage(url);
    emitStderr(`demo error message="${message}"`);
    sendJson(response, 200, { ok: true, emitted: true, stream: "stderr", message, rawMaterialReturned: false });
    return;
  }

  sendJson(response, 404, { ok: false, error: "not_found", rawMaterialReturned: false });
}

function handleCommand(line) {
  const command = sanitizeMessage(line);
  counters.commands += 1;

  if (command === "help") {
    emitStdout("command help supported=help,ping,status,emit");
    return;
  }
  if (command === "ping") {
    emitStdout("command pong");
    return;
  }
  if (command === "status") {
    emitStdout(`command status uptimeMs=${Math.max(0, Math.round(process.uptime() * 1000))} stdout=${counters.stdout} stderr=${counters.stderr}`);
    return;
  }
  if (command.startsWith("emit ")) {
    emitStdout(`command emit message="${sanitizeMessage(command.slice(5))}"`);
    return;
  }
  emitStderr("command rejected reason=unsupported");
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  await writeProviderEnvSnapshot().catch(() => undefined);

  if (server?.listening) {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
    return;
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

if (!process.stdin.isTTY) {
  const input = readline.createInterface({ input: process.stdin });
  input.on("line", handleCommand);
}

emitStdout("starting");
server = http.createServer(handleRequest);
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const boundPort = address && typeof address === "object" ? address.port : port;
  emitStdout(`listening on 127.0.0.1:${boundPort}`);
  void writeProviderEnvSnapshot();
});

heartbeat = setInterval(() => {
  counters.heartbeat += 1;
  emitStdout(`heartbeat count=${counters.heartbeat} uptimeMs=${Math.max(0, Math.round(process.uptime() * 1000))}`);
}, heartbeatMs);
