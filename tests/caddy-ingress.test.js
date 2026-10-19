import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import {
  buildCaddyRegisterPayload,
  defaultIngressDomain,
  registerCaddyIngress,
  resetCaddyIngressRegistrations,
  resolveCaddyAdminAddress,
  resolveCaddyIngressPort,
  unregisterCaddyIngress,
  getCaddyIngressRegistration,
} from "../dist/runtime/ingress/caddy.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";

test("defaultIngressDomain sanitizes core service ids", () => {
  assert.equal(defaultIngressDomain("@nextcloud"), "nextcloud.servicelasso.localhost");
  assert.equal(defaultIngressDomain("node-app"), "node-app.servicelasso.localhost");
});

test("resolveCaddyAdminAddress prefers CADDY_ADMIN_ADDR and falls back to host+port", () => {
  assert.equal(resolveCaddyAdminAddress({ CADDY_ADMIN_ADDR: "127.0.0.1:2019" }), "127.0.0.1:2019");
  assert.equal(resolveCaddyAdminAddress({ CADDY_ADMIN_PORT: "2019" }), "127.0.0.1:2019");
  assert.equal(
    resolveCaddyAdminAddress({ CADDY_ADMIN_BIND: "127.0.0.2", CADDY_ADMIN_PORT: "2020" }),
    "127.0.0.2:2020",
  );
  assert.equal(resolveCaddyAdminAddress({}), null);
});

test("resolveCaddyIngressPort uses the shared @caddy web port", () => {
  assert.equal(resolveCaddyIngressPort({ CADDY_HTTP_PORT: "8080" }), 8080);
  assert.equal(resolveCaddyIngressPort({ CADDY_HTTP_PORT: "0" }), null);
  assert.equal(resolveCaddyIngressPort({}), null);
});

test("buildCaddyRegisterPayload handles fastcgi and http upstreams", () => {
  const fastcgi = buildCaddyRegisterPayload({
    serviceId: "@nextcloud",
    ingress: {
      domain: "nextcloud.servicelasso.localhost",
      proxy: { type: "fastcgi", endpoint: "fastcgi", root: "/srv/nextcloud" },
    },
    target: "127.0.0.1:9000",
    ingressPort: 8080,
  });
  assert.deepEqual(fastcgi, {
    id: "@nextcloud",
    domain: "nextcloud.servicelasso.localhost",
    ingress_port: 8080,
    type: "fastcgi",
    target: "127.0.0.1:9000",
    root: "/srv/nextcloud",
  });

  const httpPayload = buildCaddyRegisterPayload({
    serviceId: "@node-app",
    ingress: { proxy: { type: "http", endpoint: "web" } },
    target: "127.0.0.1:3000",
    ingressPort: 8080,
    routeId: "@node-app#0",
  });
  assert.equal(httpPayload.id, "@node-app#0");
  assert.equal(httpPayload.domain, "node-app.servicelasso.localhost");
  assert.equal(httpPayload.root, undefined);

  assert.throws(
    () =>
      buildCaddyRegisterPayload({
        serviceId: "@x",
        ingress: { proxy: { type: "fastcgi", root: "" } },
        target: "127.0.0.1:9000",
        ingressPort: 8080,
      }),
    /requires "root"/,
  );
  assert.throws(
    () =>
      buildCaddyRegisterPayload({
        serviceId: "@x",
        ingress: { proxy: { type: "http" } },
        target: "127.0.0.1:3000",
        ingressPort: 0,
      }),
    /valid ingress port/,
  );
});

test("echo-service declares http ingress and @caddy is available for it", async () => {
  const discovered = await discoverServices(path.resolve("services"));
  const byId = new Map(discovered.map((service) => [service.manifest.id, service]));

  const echo = byId.get("echo-service");
  assert.ok(echo, "echo-service manifest should be discovered");
  assert.ok(Array.isArray(echo.manifest.ingress) && echo.manifest.ingress.length === 1);
  assert.deepEqual(echo.manifest.ingress[0], {
    domain: "echo-service.servicelasso.localhost",
    proxy: { type: "http", endpoint: "service" },
  });

  const caddy = byId.get("@caddy");
  assert.ok(caddy, "@caddy manifest should be discovered");
  assert.deepEqual(
    caddy.manifest.endpoints.map((endpoint) => endpoint.id),
    ["web", "admin", "web_url", "health"],
  );

  const payload = buildCaddyRegisterPayload({
    serviceId: echo.manifest.id,
    ingress: echo.manifest.ingress[0],
    target: `127.0.0.1:${echo.manifest.ports.service}`,
    ingressPort: 8080,
  });
  assert.equal(payload.type, "http");
  assert.equal(payload.domain, "echo-service.servicelasso.localhost");
  assert.equal(payload.target, "127.0.0.1:4010");
  assert.equal(payload.root, undefined);
});

test("registerCaddyIngress and unregisterCaddyIngress call the admin API", async () => {
  resetCaddyIngressRegistrations();
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: JSON.parse(body) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "success" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const adminAddress = `127.0.0.1:${address.port}`;

  try {
    const payload = buildCaddyRegisterPayload({
      serviceId: "@nextcloud",
      ingress: { proxy: { type: "fastcgi", root: "/srv/nextcloud" } },
      target: "127.0.0.1:9000",
      ingressPort: 8080,
    });
    await registerCaddyIngress(adminAddress, payload);
    assert.equal(getCaddyIngressRegistration("@nextcloud")?.adminAddress, adminAddress);

    await unregisterCaddyIngress(adminAddress, "@nextcloud");
    assert.equal(getCaddyIngressRegistration("@nextcloud"), undefined);

    assert.deepEqual(
      requests.map((request) => request.url),
      ["/service-lasso/register", "/service-lasso/unregister"],
    );
    assert.deepEqual(requests[1].body, { id: "@nextcloud" });
  } finally {
    resetCaddyIngressRegistrations();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("registerCaddyIngress surfaces a non-2xx admin response", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(422, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "error" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await assert.rejects(
      () =>
        registerCaddyIngress(`127.0.0.1:${address.port}`, {
          id: "@x",
          domain: "x.servicelasso.localhost",
          ingress_port: 8080,
          type: "http",
          target: "127.0.0.1:3000",
        }),
      /returned 422/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
