import test from "node:test";
import assert from "node:assert/strict";
import { resolveRuntimeRequestAuth } from "../dist/runtime/auth/request-policy.js";

function request(remoteAddress, headers = {}) {
  return {
    headers,
    socket: { remoteAddress },
  };
}

test("Bearer parsing is linear, exact, and preserves supported HTTP whitespace", () => {
  const token = "test-local-admin-token";
  const accepted = resolveRuntimeRequestAuth(
    request("192.0.2.40", {
      authorization: `Bearer${" ".repeat(16_384)}${token}`,
    }),
    {
      bindHost: "0.0.0.0",
      env: { SERVICE_LASSO_LOCAL_ADMIN_TOKEN: token },
    },
  );
  assert.equal(accepted.actor.kind, "local-token");
  assert.deepEqual(accepted.blockers, []);

  const acceptedTab = resolveRuntimeRequestAuth(
    request("192.0.2.40", { authorization: `bEaReR\t${token}` }),
    {
      bindHost: "0.0.0.0",
      env: { SERVICE_LASSO_LOCAL_ADMIN_TOKEN: token },
    },
  );
  assert.equal(acceptedTab.actor.kind, "local-token");

  const rejected = resolveRuntimeRequestAuth(
    request("192.0.2.40", { authorization: `BearerX ${token}` }),
    {
      bindHost: "0.0.0.0",
      env: { SERVICE_LASSO_LOCAL_ADMIN_TOKEN: token },
    },
  );
  assert.equal(rejected.actor.authenticated, false);
  assert.deepEqual(rejected.blockers, ["remote_auth_required"]);
});

test("direct remote requests cannot spoof forwarded local-root or Zitadel identity", () => {
  const result = resolveRuntimeRequestAuth(
    request("192.0.2.40", {
      "x-forwarded-for": "127.0.0.1",
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-proxy": "serviceadmin",
      "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
      "x-service-lasso-client-address": "127.0.0.1",
      "x-service-lasso-zitadel-user-id": "spoofed-user",
      "x-service-lasso-user": "spoofed-traefik-user",
      "x-service-lasso-actor": "spoofed-traefik-actor",
    }),
    {
      bindHost: "0.0.0.0",
      env: {
        SERVICE_LASSO_TRUST_PROXY_HEADERS: "true",
        SERVICE_LASSO_ZITADEL_ENABLED: "true",
      },
    },
  );

  assert.equal(result.request.clientAddress, "192.0.2.40");
  assert.equal(result.request.local, false);
  assert.equal(result.policy.trustProxyHeaders, false);
  assert.equal(result.actor.authenticated, false);
  assert.equal(result.actor.actorId, null);
  assert.deepEqual(result.blockers, ["remote_auth_required"]);
  assert.doesNotMatch(JSON.stringify(result), /spoofed-user|spoofed-traefik|password|Bearer /);
});

test("exact loopback Service Admin proxy can carry authenticated remote identity", () => {
  const result = resolveRuntimeRequestAuth(
    request("127.0.0.1", {
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-proxy": "serviceadmin",
      "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
      "x-service-lasso-client-address": "192.0.2.40",
      "x-service-lasso-zitadel-user-id": "usr_trusted_operator",
    }),
    { bindHost: "0.0.0.0", env: {} },
  );

  assert.equal(result.request.clientAddress, "192.0.2.40");
  assert.equal(result.request.local, false);
  assert.equal(result.policy.trustProxyHeaders, true);
  assert.equal(result.policy.zitadelEnabled, true);
  assert.equal(result.actor.kind, "zitadel");
  assert.equal(result.actor.actorId, "usr_trusted_operator");
  assert.deepEqual(result.blockers, []);
});

test("Traefik User/Roles/Actor from exact loopback ingress is the trusted actor", () => {
  const result = resolveRuntimeRequestAuth(
    request("127.0.0.1", {
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-proxy": "serviceadmin",
      "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
      "x-service-lasso-client-address": "192.0.2.40",
      "x-service-lasso-user": "usr_traefik_operator",
      "x-service-lasso-actor": "usr_traefik_operator",
      "x-service-lasso-roles": "operator,viewer",
      "x-service-lasso-workspace": "wks_protected",
    }),
    { bindHost: "127.0.0.1", env: {} },
  );

  assert.equal(result.request.local, false);
  assert.equal(result.actor.kind, "zitadel");
  assert.equal(result.actor.actorId, "usr_traefik_operator");
  assert.deepEqual(result.actor.roles, ["operator", "viewer"]);
  assert.deepEqual(result.blockers, []);
  assert.doesNotMatch(JSON.stringify(result), /password|Bearer |LOCAL_ADMIN_TOKEN/);
});

test("mismatched Traefik User and canonical Zitadel user id fails closed", () => {
  const result = resolveRuntimeRequestAuth(
    request("127.0.0.1", {
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-proxy": "serviceadmin",
      "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
      "x-service-lasso-client-address": "192.0.2.40",
      "x-service-lasso-user": "usr_traefik_operator",
      "x-service-lasso-zitadel-user-id": "usr_other_operator",
    }),
    { bindHost: "127.0.0.1", env: {} },
  );

  assert.equal(result.actor.authenticated, false);
  assert.equal(result.actor.kind, null);
  assert.equal(result.policy.remoteAuthRequired, true);
  assert.deepEqual(result.blockers, ["trusted_ingress_identity_mismatch"]);
});

test("mismatched Traefik Actor and User fails closed", () => {
  const result = resolveRuntimeRequestAuth(
    request("127.0.0.1", {
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-proxy": "serviceadmin",
      "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
      "x-service-lasso-client-address": "10.0.0.8",
      "x-service-lasso-user": "usr_traefik_operator",
      "x-service-lasso-actor": "usr_other_actor",
    }),
    { bindHost: "127.0.0.1", env: {} },
  );

  assert.equal(result.actor.authenticated, false);
  assert.deepEqual(result.blockers, ["trusted_ingress_identity_mismatch"]);
});

test("trusted-ingress without Traefik or canonical user fails closed instead of local-root", () => {
  const result = resolveRuntimeRequestAuth(
    request("127.0.0.1", {
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-proxy": "serviceadmin",
      "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
    }),
    { bindHost: "127.0.0.1", env: {} },
  );

  assert.equal(result.request.local, true);
  assert.equal(result.actor.authenticated, false);
  assert.equal(result.actor.kind, null);
  assert.equal(result.policy.remoteAuthRequired, true);
  assert.deepEqual(result.blockers, ["trusted_ingress_identity_missing"]);
});
