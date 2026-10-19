import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  buildCaddyRegisterPayload,
  defaultIngressDomain,
  registerCaddyIngress,
  resetCaddyIngressRegistrations,
  resolveCaddyAdminAddress,
  unregisterCaddyIngress,
  getCaddyIngressRegistration,
} from "../dist/runtime/ingress/caddy.js";

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

test("buildCaddyRegisterPayload handles fastcgi and http upstreams", () => {
  const fastcgi = buildCaddyRegisterPayload({
    serviceId: "@nextcloud",
    ingress: {
      type: "fastcgi",
      domain: "nextcloud.servicelasso.localhost",
      endpoint: "fastcgi",
      root: "/srv/nextcloud",
    },
    target: "127.0.0.1:9000",
    ingressPort: 50123,
  });
  assert.deepEqual(fastcgi, {
    id: "@nextcloud",
    domain: "nextcloud.servicelasso.localhost",
    ingress_port: 50123,
    type: "fastcgi",
    target: "127.0.0.1:9000",
    root: "/srv/nextcloud",
  });

  const httpPayload = buildCaddyRegisterPayload({
    serviceId: "@node-app",
    ingress: { type: "http", endpoint: "web" },
    target: "127.0.0.1:3000",
    ingressPort: 50124,
  });
  assert.equal(httpPayload.domain, "node-app.servicelasso.localhost");
  assert.equal(httpPayload.root, undefined);

  assert.throws(
    () =>
      buildCaddyRegisterPayload({
        serviceId: "@x",
        ingress: { type: "fastcgi", root: "" },
        target: "127.0.0.1:9000",
        ingressPort: 50123,
      }),
    /requires "root"/,
  );
  assert.throws(
    () =>
      buildCaddyRegisterPayload({
        serviceId: "@x",
        ingress: { type: "http" },
        target: "127.0.0.1:3000",
        ingressPort: 0,
      }),
    /valid ingress port/,
  );
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
      ingress: { type: "fastcgi", root: "/srv/nextcloud" },
      target: "127.0.0.1:9000",
      ingressPort: 50123,
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
          ingress_port: 50123,
          type: "http",
          target: "127.0.0.1:3000",
        }),
      /returned 422/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
