import test from "node:test";
import assert from "node:assert/strict";
import { buildEffectiveRouteMetadata } from "../dist/runtime/operator/endpoints.js";

function makeService(manifest) {
  return {
    manifest: {
      id: "route-fixture",
      name: "Route Fixture",
      description: "Route metadata fixture",
      ...manifest,
    },
    manifestPath: "services/route-fixture/service.json",
    serviceRoot: "services/route-fixture",
    catalogProvenance: {
      sourcePath: "services/route-fixture/service.json",
      sourceType: null,
      repo: null,
      releaseTag: null,
      assetNames: [],
      checksumPresent: false,
      packagedRuntimeVersion: null,
    },
  };
}

test("builds effective route metadata for Traefik-backed and runtime-local endpoints", () => {
  const routes = buildEffectiveRouteMetadata(
    makeService({
      endpoints: [
        {
          id: "admin",
          kind: "network",
          label: "Admin UI",
          protocol: "http",
          bind: "127.0.0.1",
          port: { default: 17700, strategy: "fixed" },
          exposure: "public",
        },
        {
          id: "metrics",
          kind: "network",
          label: "Metrics",
          protocol: "tcp",
          bind: "127.0.0.1",
          port: { default: 19100, strategy: "fixed" },
          exposure: "local",
        },
      ],
    }),
    { admin: 17700, metrics: 19100 },
  );

  assert.equal(routes.contractVersion, "service-lasso.route-metadata.v1");
  assert.equal(routes.routes.length, 2);

  const admin = routes.routes.find((route) => route.endpoint.id === "admin");
  assert.equal(admin.provider, "traefik");
  assert.equal(admin.state, "active");
  assert.equal(admin.configSource, "generated-config");
  assert.equal(admin.target.port, 17700);
  assert.equal(admin.traefik.routerName, "route-fixture-admin-servicelasso-local");
  assert.equal(admin.traefik.serviceName, "route-fixture-admin-backend");
  assert.deepEqual(admin.traefik.middlewareNames, [
    "servicelasso-strip-spoofed-identity",
    "servicelasso-forward-auth",
  ]);
  assert.match(admin.traefik.rule, /route-fixture-admin\.servicelasso\.localhost/);

  const metrics = routes.routes.find((route) => route.endpoint.id === "metrics");
  assert.equal(metrics.provider, "service-lasso-runtime");
  assert.equal(metrics.state, "active");
  assert.equal(metrics.traefik, undefined);
});

test("reports pending and unavailable route states without inventing Traefik config", () => {
  const routes = buildEffectiveRouteMetadata(
    makeService({
      endpoints: [
        {
          id: "auto",
          kind: "network",
          label: "Automatic",
          protocol: "http",
          port: { default: 0, strategy: "automatic" },
          exposure: "public",
        },
        {
          id: "missing",
          kind: "network",
          label: "Missing",
          protocol: "http",
          exposure: "lan",
        },
      ],
    }),
    {},
  );

  const auto = routes.routes.find((route) => route.endpoint.id === "auto");
  assert.equal(auto.provider, "unavailable");
  assert.equal(auto.state, "pending");
  assert.equal(auto.configSource, "runtime-default");
  assert.equal(auto.traefik, undefined);

  const missing = routes.routes.find((route) => route.endpoint.id === "missing");
  assert.equal(missing.provider, "unavailable");
  assert.equal(missing.state, "unavailable");
  assert.equal(missing.configSource, "unavailable");
});

test("serializes URL route metadata without leaking query or secret-like material", () => {
  const rawSecretSentinel = "client_secret=do-not-render-this";
  const routes = buildEffectiveRouteMetadata(
    makeService({
      endpoints: [
        {
          id: "docs",
          kind: "url",
          label: "Docs",
          url: "https://docs.example.test/reference?session_cookie=hidden",
          exposure: "public",
        },
        {
          id: "unsafe",
          kind: "url",
          label: "Unsafe",
          url: `https://example.test/callback?${rawSecretSentinel}`,
          exposure: "public",
        },
      ],
    }),
  );

  const docs = routes.routes.find((route) => route.endpoint.id === "docs");
  assert.equal(docs.state, "invalid");
  assert.equal(docs.target.host, undefined);

  const unsafe = routes.routes.find((route) => route.endpoint.id === "unsafe");
  assert.equal(unsafe.state, "invalid");
  assert.equal(unsafe.configSource, "invalid");
  assert.doesNotMatch(JSON.stringify(routes), /do-not-render-this/);
  assert.doesNotMatch(JSON.stringify(routes), /session_cookie=hidden/);
});
