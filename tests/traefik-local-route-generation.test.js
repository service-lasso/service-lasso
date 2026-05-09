import test from "node:test";
import assert from "node:assert/strict";
import {
  buildServiceLassoTraefikDynamicConfig,
  composeServiceLassoLocalHostname,
  renderServiceLassoTraefikDynamicConfigYaml,
} from "../dist/runtime/traefik/local-route-generation.js";

test("composes Service Lasso local hostnames under servicelasso.localhost", () => {
  assert.equal(
    composeServiceLassoLocalHostname("@serviceadmin"),
    "serviceadmin.servicelasso.localhost",
  );
  assert.equal(
    composeServiceLassoLocalHostname("workflow-ui"),
    "workflow-ui.servicelasso.localhost",
  );
  assert.throws(
    () =>
      composeServiceLassoLocalHostname("serviceadmin", {
        domainSuffix: "local",
      }),
    /localhost suffix/,
  );
});

test("generates protected Traefik routers services and middleware references", () => {
  const config = buildServiceLassoTraefikDynamicConfig([
    {
      appId: "@serviceadmin",
      serviceId: "@serviceadmin",
      backendUrl: "http://127.0.0.1:${SERVICEADMIN_PORT}",
    },
  ]);

  assert.deepEqual(config.http.routers["serviceadmin-servicelasso-local"], {
    rule: "Host(`serviceadmin.servicelasso.localhost`)",
    entryPoints: ["websecure"],
    middlewares: [
      "servicelasso-strip-spoofed-identity",
      "servicelasso-forward-auth",
    ],
    service: "serviceadmin-backend",
    tls: {},
  });
  assert.equal(
    config.http.services["serviceadmin-backend"].loadBalancer.servers[0].url,
    "http://127.0.0.1:${SERVICEADMIN_PORT}",
  );
  assert.equal(
    config.http.middlewares["servicelasso-forward-auth"].forwardAuth
      .trustForwardHeader,
    false,
  );
});

test("renders stable dynamic.yml fixture without .local shorthand or bypass routes", () => {
  const yaml = renderServiceLassoTraefikDynamicConfigYaml(
    buildServiceLassoTraefikDynamicConfig([
      {
        appId: "@serviceadmin",
        serviceId: "@serviceadmin",
        backendUrl: "http://127.0.0.1:${SERVICEADMIN_PORT}",
      },
    ]),
  );

  assert.match(yaml, /Host\(`serviceadmin\.servicelasso\.localhost`\)/);
  assert.match(yaml, /servicelasso-strip-spoofed-identity/);
  assert.match(yaml, /servicelasso-forward-auth/);
  assert.match(yaml, /X-ServiceLasso-User-ID: ""/);
  assert.match(yaml, /authResponseHeaders:\n\s+- X-ServiceLasso-User-ID/);
  assert.doesNotMatch(yaml, /servicelasso\.local(?!host)/);
  assert.doesNotMatch(yaml, /serviceadmin-(?:bypass|unprotected)/);
});

test("allows explicit public routes but never creates a default unauthenticated bypass", () => {
  const config = buildServiceLassoTraefikDynamicConfig([
    {
      appId: "@serviceadmin",
      serviceId: "@serviceadmin",
      backendUrl: "http://127.0.0.1:${SERVICEADMIN_PORT}",
    },
    {
      appId: "status",
      serviceId: "status",
      backendUrl: "http://127.0.0.1:${STATUS_PORT}",
      protected: false,
    },
  ]);

  assert.deepEqual(
    config.http.routers["serviceadmin-servicelasso-local"].middlewares,
    ["servicelasso-strip-spoofed-identity", "servicelasso-forward-auth"],
  );
  assert.equal(
    config.http.routers["status-servicelasso-local"].middlewares,
    undefined,
  );
  assert.equal(
    Object.keys(config.http.routers).some((name) =>
      /serviceadmin-(?:bypass|unprotected)/.test(name),
    ),
    false,
  );
});

test("rejects secret-like material in generated route inputs", () => {
  assert.throws(
    () =>
      buildServiceLassoTraefikDynamicConfig([
        {
          appId: "@serviceadmin",
          serviceId: "@serviceadmin",
          backendUrl:
            "http://127.0.0.1:${SERVICEADMIN_PORT}?client_secret=do-not-place-secrets-here",
        },
      ]),
    /secret-like material/,
  );
});
