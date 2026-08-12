import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertLocalSsoLoopSmokeEvidence,
  assertSafeLocalSsoSmokeConfig,
  buildLocalSsoLoopSmokeFixture,
  writeLocalSsoLoopSmokeEvidence,
} from "../scripts/local-sso-loop-smoke.mjs";

const forbiddenOutput =
  /ACTUAL_SECRET|BEGIN PRIVATE KEY|access_token\s*[:=]|refresh_token\s*[:=]|id_token\s*[:=]|session_cookie\s*[:=]|client_secret\s*[:=]|provider_credential\s*[:=]|raw_secret\s*[:=]|password\s*[:=]|Bearer\s+[A-Za-z0-9._~+/-]{24,}/i;

test("local SSO loop smoke fixture contains Service Admin auth callback and ZITADEL routes", () => {
  const fixture = buildLocalSsoLoopSmokeFixture();
  const routers = fixture.traefikDynamicConfig.http.routers;

  assert.equal(routers["serviceadmin-protected"].rule, "Host(`serviceadmin.servicelasso.localhost`)");
  assert.equal(
    routers["auth-callback"].rule,
    "Host(`auth.servicelasso.localhost`) && PathPrefix(`/oauth2/callback`)",
  );
  assert.equal(routers["zitadel-login"].rule, "Host(`zitadel.servicelasso.localhost`)");
  assert.deepEqual(routers["serviceadmin-protected"].middlewares, [
    "strip-browser-identity-headers",
    "traefik-oidc-auth",
  ]);
});

test("local SSO loop smoke fixture strips spoofed identity headers and forwards only trusted headers", () => {
  const fixture = buildLocalSsoLoopSmokeFixture();
  const middlewares = fixture.traefikDynamicConfig.http.middlewares;
  const stripped = middlewares["strip-browser-identity-headers"].headers.customRequestHeaders;
  const forwardAuth = middlewares["traefik-oidc-auth"].forwardAuth;

  assert.equal(stripped["X-ServiceLasso-User-ID"], "");
  assert.equal(stripped["X-Service-Lasso-User"], "");
  assert.equal(stripped["X-Forwarded-User"], "");
  assert.equal(stripped["X-Auth-Request-Email"], "");
  assert.equal(forwardAuth.trustForwardHeader, false);
  assert.deepEqual(forwardAuth.authResponseHeaders, [
    "X-ServiceLasso-User-ID",
    "X-ServiceLasso-Workspace-ID",
    "X-ServiceLasso-Email",
    "X-ServiceLasso-Roles",
    "X-ServiceLasso-Auth-Method",
    "X-ServiceLasso-Audit-Actor",
  ]);
});

test("local SSO loop smoke fixture covers redirect callback authenticated return and fail closed", () => {
  const fixture = buildLocalSsoLoopSmokeFixture();

  assert.deepEqual(
    fixture.browserFlow.map((step) => step.step),
    [
      "unauthenticated_serviceadmin_request",
      "oidc_callback_fixture",
      "authenticated_serviceadmin_return",
      "auth_unavailable_fail_closed",
    ],
  );
  assert.equal(
    fixture.browserFlow[0].expect.locationStartsWith,
    "https://zitadel.servicelasso.localhost",
  );
  assert.equal(
    fixture.browserFlow[1].expect.location,
    "https://serviceadmin.servicelasso.localhost",
  );
  assert.ok(
    fixture.browserFlow[2].expect.pageTextIncludes.includes("workspace:service-lasso/local-dev"),
  );
  assert.equal(fixture.browserFlow[3].expect.upstreamServiceAdminReached, false);
});

test("local SSO loop smoke evidence is metadata-only and leak checked across captured surfaces", () => {
  const fixture = buildLocalSsoLoopSmokeFixture();
  const text = JSON.stringify(fixture);

  assertLocalSsoLoopSmokeEvidence(fixture);
  assert.doesNotMatch(text, forbiddenOutput);
  assert.doesNotMatch(text, /auth facade|service-lasso-auth/i);
  assert.doesNotMatch(text, /servicelasso\.local(?!host)/);
  assert.doesNotMatch(text, /serviceadmin-(?:bypass|unprotected)/);
  assert.match(text, /local-sso-smoke fixture completed without credential output/);
});

test("local SSO loop smoke rejects .local and secret-like config", () => {
  assert.throws(
    () =>
      assertSafeLocalSsoSmokeConfig({
        serviceAdminHost: "serviceadmin.servicelasso.local",
      }),
    /servicelasso\.localhost|\.local/,
  );

  assert.throws(
    () =>
      assertSafeLocalSsoSmokeConfig({
        oidcMiddlewareAuthUrl: "http://127.0.0.1/auth?client_secret=ACTUAL_SECRET",
      }),
    /secret-like material/,
  );
});

test("local SSO loop smoke evidence can be written for PR validation", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-sso-loop-"));
  try {
    const outputPath = path.join(tempRoot, "local-sso-loop-smoke.evidence.json");
    await writeLocalSsoLoopSmokeEvidence(outputPath);
    const written = await readFile(outputPath, "utf8");

    assert.match(written, /serviceadmin\.servicelasso\.localhost/);
    assert.match(written, /auth\.servicelasso\.localhost/);
    assert.match(written, /zitadel\.servicelasso\.localhost/);
    assert.match(written, /traefik-oidc-auth/);
    assert.doesNotMatch(written, forbiddenOutput);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
