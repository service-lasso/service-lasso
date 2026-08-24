import test from "node:test";
import assert from "node:assert/strict";
import {
  getEffectiveClientAddress,
  isLoopbackAddress,
  resolveRuntimeRequestAuth,
} from "../dist/runtime/auth/request-policy.js";
import {
  ORIGINAL_CLIENT_ADDRESS_HEADER,
  SERVICEADMIN_PROXY_HEADER,
  SERVICEADMIN_PROXY_VALUE,
  TRUSTED_INGRESS_HEADER,
  TRUSTED_INGRESS_VALUE,
} from "../dist/runtime/auth/local-auth-constants.js";

function fakeRequest(remoteAddress, headers = {}) {
  return {
    socket: { remoteAddress },
    headers,
  };
}

test("loopback addresses are local-root even when FORCE_SSO is on", () => {
  for (const address of ["127.0.0.1", "::1", "localhost", "127.0.0.9"]) {
    const auth = resolveRuntimeRequestAuth(fakeRequest(address), {
      bindHost: "0.0.0.0",
      forceSso: true,
      env: {},
    });
    assert.equal(auth.request.local, true);
    assert.equal(auth.actor.kind, "local-root");
    assert.equal(auth.actor.authenticated, true);
    assert.deepEqual(auth.blockers, []);
  }
});

test("0.0.0.0 is not treated as a loopback origin", () => {
  assert.equal(isLoopbackAddress("0.0.0.0"), false);
  const auth = resolveRuntimeRequestAuth(fakeRequest("192.168.1.50"), {
    bindHost: "0.0.0.0",
    env: {},
  });
  assert.equal(auth.request.local, false);
  assert.equal(auth.actor.authenticated, false);
  assert.equal(auth.mode, "blocked");
});

test("loopback Admin proxy forwards LAN client and does not grant local-root", () => {
  const request = fakeRequest("127.0.0.1", {
    [ORIGINAL_CLIENT_ADDRESS_HEADER]: "192.168.10.20",
    [SERVICEADMIN_PROXY_HEADER]: SERVICEADMIN_PROXY_VALUE,
    [TRUSTED_INGRESS_HEADER]: TRUSTED_INGRESS_VALUE,
  });
  const effective = getEffectiveClientAddress(request, true);
  assert.equal(effective, "192.168.10.20");
  const auth = resolveRuntimeRequestAuth(request, {
    bindHost: "0.0.0.0",
    env: {},
  });
  assert.equal(auth.request.local, false);
  assert.equal(auth.actor.kind, null);
});

test("non-loopback peers cannot spoof loopback via forwarded client headers", () => {
  const request = fakeRequest("192.168.1.8", {
    [ORIGINAL_CLIENT_ADDRESS_HEADER]: "127.0.0.1",
    "x-forwarded-for": "127.0.0.1",
  });
  const auth = resolveRuntimeRequestAuth(request, {
    bindHost: "0.0.0.0",
    env: {},
  });
  assert.equal(auth.request.clientAddress, "192.168.1.8");
  assert.equal(auth.actor.authenticated, false);
});

test("valid local-admin token authenticates remote as local-token", () => {
  const auth = resolveRuntimeRequestAuth(
    fakeRequest("10.0.0.8", {
      "x-service-lasso-admin-token": "test-local-admin-token",
    }),
    {
      bindHost: "0.0.0.0",
      env: { SERVICE_LASSO_LOCAL_ADMIN_TOKEN: "test-local-admin-token" },
    },
  );
  assert.equal(auth.actor.kind, "local-token");
  assert.equal(auth.policy.localTokenConfigured, true);
});

test("FORCE_SSO rejects remote token login and requires a ZITADEL actor", () => {
  const denied = resolveRuntimeRequestAuth(
    fakeRequest("10.0.0.9", {
      "x-service-lasso-admin-token": "test-local-admin-token",
    }),
    {
      bindHost: "0.0.0.0",
      forceSso: true,
      env: { SERVICE_LASSO_LOCAL_ADMIN_TOKEN: "test-local-admin-token" },
    },
  );
  assert.equal(denied.actor.authenticated, false);
  assert.ok(denied.blockers.includes("force_sso_required"));

  const allowed = resolveRuntimeRequestAuth(
    fakeRequest("127.0.0.1", {
      "x-service-lasso-zitadel-user-id": "usr_fake_idp",
      [ORIGINAL_CLIENT_ADDRESS_HEADER]: "10.0.0.9",
      [SERVICEADMIN_PROXY_HEADER]: SERVICEADMIN_PROXY_VALUE,
      [TRUSTED_INGRESS_HEADER]: TRUSTED_INGRESS_VALUE,
    }),
    {
      bindHost: "0.0.0.0",
      forceSso: true,
      env: {
        SERVICE_LASSO_ZITADEL_ENABLED: "true",
        SERVICE_LASSO_LOCAL_ADMIN_TOKEN: "test-local-admin-token",
      },
    },
  );
  assert.equal(allowed.actor.kind, "zitadel");
  assert.equal(allowed.policy.identityProviders[0]?.id, "zitadel");
});

test("FORCE_SSO does not hide loopback local-token or identity providers", () => {
  const withToken = resolveRuntimeRequestAuth(
    fakeRequest("127.0.0.1", {
      "x-service-lasso-admin-token": "test-local-admin-token",
    }),
    {
      bindHost: "0.0.0.0",
      forceSso: true,
      env: {
        SERVICE_LASSO_LOCAL_ADMIN_TOKEN: "test-local-admin-token",
        SERVICE_LASSO_ZITADEL_ENABLED: "true",
      },
    },
  );
  assert.equal(withToken.request.local, true);
  assert.equal(withToken.actor.kind, "local-token");
  assert.equal(withToken.policy.forceSso, true);
  assert.equal(withToken.policy.identityProviders[0]?.id, "zitadel");
  assert.deepEqual(withToken.blockers, []);

  const withProvider = resolveRuntimeRequestAuth(
    fakeRequest("localhost", {
      "x-service-lasso-zitadel-user-id": "usr_fake_idp",
      [TRUSTED_INGRESS_HEADER]: TRUSTED_INGRESS_VALUE,
      [SERVICEADMIN_PROXY_HEADER]: SERVICEADMIN_PROXY_VALUE,
    }),
    {
      bindHost: "0.0.0.0",
      forceSso: true,
      env: { SERVICE_LASSO_ZITADEL_ENABLED: "true" },
    },
  );
  assert.equal(withProvider.request.local, true);
  assert.equal(withProvider.actor.kind, "zitadel");
  assert.equal(withProvider.policy.identityProviders[0]?.id, "zitadel");
  assert.deepEqual(withProvider.blockers, []);
});

test("loopback first-run flags stay on the security contract without changing local-root", () => {
  const pending = resolveRuntimeRequestAuth(fakeRequest("127.0.0.1"), {
    bindHost: "127.0.0.1",
    firstRunPending: true,
    credentialsAcknowledged: false,
    env: {},
  });
  assert.equal(pending.actor.kind, "local-root");
  assert.equal(pending.policy.firstRunPending, true);
  assert.equal(pending.policy.credentialsAcknowledged, false);

  const remote = resolveRuntimeRequestAuth(fakeRequest("10.0.0.8"), {
    bindHost: "0.0.0.0",
    firstRunPending: true,
    credentialsAcknowledged: false,
    env: {},
  });
  assert.equal(remote.request.local, false);
  assert.equal(remote.policy.firstRunPending, false);
  assert.equal(remote.policy.credentialsAcknowledged, true);
});

test("legacy missing first-run flags default to acknowledged on loopback", () => {
  const auth = resolveRuntimeRequestAuth(fakeRequest("127.0.0.1"), {
    bindHost: "127.0.0.1",
    env: {},
  });
  assert.equal(auth.policy.firstRunPending, false);
  assert.equal(auth.policy.credentialsAcknowledged, true);
});
