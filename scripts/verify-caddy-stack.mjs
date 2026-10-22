import { mkdir, mkdtemp, cp, rm } from "node:fs/promises";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startApiServer } from "../dist/server/index.js";
import { getLifecycleState } from "../dist/runtime/lifecycle/store.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lessonServices =
  process.env.LESSON_SERVICES_ROOT ??
  path.resolve(repoRoot, "..", "lesson-todo", "lessons", "06-caddy", "services");
const order = ["@caddy", "php", "php-page"];
const domain = "php-page.servicelasso.localhost";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-caddy-stack-"));
const servicesRoot = path.join(tempRoot, "services");
const workspaceRoot = path.join(tempRoot, "workspace");
await cp(lessonServices, servicesRoot, { recursive: true });
await mkdir(workspaceRoot, { recursive: true });

process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(tempRoot, "registry.json");
process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(tempRoot, "ports.json");

function httpGet(port, host, urlPath) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: "127.0.0.1", port, path: urlPath, method: "GET", agent: false, headers: { Host: host } },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: data }));
      },
    );
    request.on("error", reject);
    request.end();
  });
}
const server = await startApiServer({
  host: "127.0.0.1",
  port: 0,
  servicesRoot,
  workspaceRoot,
  noAutostart: true,
});

async function post(urlPath) {
  const response = await fetch(server.url + urlPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return { status: response.status, body: await response.text() };
}

async function get(urlPath, host) {
  const headers = host ? { host } : {};
  const response = await fetch(server.url + urlPath, { headers });
  return { status: response.status, body: await response.text() };
}

try {
  for (const id of order) {
    for (const action of ["install", "config", "start"]) {
      const result = await post(`/api/services/${encodeURIComponent(id)}/${action}`);
      console.log(`[stack] ${id} ${action} -> ${result.status} ${result.body.slice(0, 160)}`);
      if (result.status !== 200) { console.error(`[stack] ${id} ${action} body: ${result.body}`);
        throw new Error(`[stack] ${id} ${action} failed with ${result.status}`);
      }
    }
  }

  const caddyState = getLifecycleState("@caddy");
  const webPort = caddyState?.runtime?.ports?.web ?? caddyState?.runtime?.endpoints?.find?.((e) => e.id === "web")?.port;
  if (!webPort) {
    throw new Error(`[stack] could not resolve @caddy web port: ${JSON.stringify(caddyState?.runtime?.endpoints)}`);
  }

  console.log("[stack] registrations:", JSON.stringify(listCaddyIngressRegistrations("php-page")));
  const routed = await httpGet(webPort, domain, "/index.php");
  const body = routed.body;
  console.log(`[stack] caddy ${webPort} -> ${routed.status} ${JSON.stringify(body.slice(0, 120))}`);
  if (routed.status !== 200 || !body.includes("hello from php-page")) {
    throw new Error(`[stack] php-page did not route through caddy: ${routed.status} ${JSON.stringify(body)}`);
  }
  console.log("[stack] core -> caddy -> php-cgi -> php page passed");
} finally {
  for (const id of [...order].reverse()) {
    try {
      await post(`/api/services/${encodeURIComponent(id)}/stop`);
    } catch {}
  }
  await server.stop();
  await rm(tempRoot, { recursive: true, force: true });
}
