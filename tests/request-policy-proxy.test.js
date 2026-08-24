import test from "node:test";
import assert from "node:assert/strict";
import { resolveRuntimeRequestAuth } from "../dist/runtime/auth/request-policy.js";

function request(remoteAddress, headers = {}) {
  return {
    headers,
    socket: { remoteAddress },
  };
}

test("direct remote requests cannot spoof forwarded local-root or Zitadel identity", () => {
  const result = resolveRuntimeRequestAuth(
    request("192.0.2.40", {
      "x-forwarded-for": "127.0.0.1",
      "x-service-lasso-internal-proxy": "serviceadmin",
      "x-service-lasso-proxy": "serviceadmin",
      "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
      "x-service-lasso-client-address": "127.0.0.1",
      "x-service-lasso-zitadel-user-id": "spoofed-user",
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
