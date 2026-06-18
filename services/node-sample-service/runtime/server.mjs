import { createServer } from "node:http";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const heartbeat = setInterval(() => {}, 1000);
const servicePort = Number(process.env.NODE_SAMPLE_PORT ?? process.env.SERVICE_PORT ?? 0);
let server = null;

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
      },
      null,
      2,
    ),
    "utf8",
  );
}

function shutdown() {
  clearInterval(heartbeat);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

void writeProviderEnvSnapshot();

if (Number.isInteger(servicePort) && servicePort > 0) {
  server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ service: "node-sample-service", status: "ok" }));
      return;
    }

    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Node Sample Service</title></head><body><h1>Node Sample Service</h1><p>Service Lasso provider-backed sample is running.</p></body></html>");
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  server.listen(servicePort, "127.0.0.1");
}
