import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertSafeLocalSsoConfig,
  buildLocalSsoBootstrapPlan,
  writeLocalSsoBootstrapPlan,
} from "../scripts/local-sso-bootstrap.mjs";

const forbiddenOutput = /ACTUAL_SECRET|BEGIN PRIVATE KEY|access_token=|refresh_token=|id_token=|session_cookie=|client_secret=|password=/i;

test("local SSO bootstrap emits servicelasso.localhost Traefik and ZITADEL metadata", () => {
  const plan = buildLocalSsoBootstrapPlan();

  assert.equal(plan.status, "ready-to-apply");
  assert.match(plan.ownerBoundary, /traefik-oidc-auth/i);
  assert.doesNotMatch(plan.ownerBoundary, new RegExp("auth " + "facade|" + "service-lasso" + "-auth", "i"));
  assert.equal(plan.domains.serviceAdmin, "https://serviceadmin.servicelasso.localhost");
  assert.equal(plan.domains.zitadel, "https://zitadel.servicelasso.localhost");
  assert.equal(plan.zitadelClientRegistration.serviceId, "traefik-oidc-auth");
  assert.equal(plan.zitadelClientRegistration.displayName, "Service Lasso Traefik OIDC middleware");
  assert.deepEqual(plan.zitadelClientRegistration.redirectUris, [
    "https://serviceadmin.servicelasso.localhost/oauth2/callback",
  ]);
  assert.equal(
    plan.zitadelClientRegistration.clientSecretRef,
    "secretref://@secretsbroker/zitadel/traefik-oidc-auth/client-secret",
  );
});

test("local SSO bootstrap protects routes through the external OIDC middleware", () => {
  const plan = buildLocalSsoBootstrapPlan();
  const serviceAdminRouter = plan.traefikDynamicConfig.routers.find((router) => router.name === "serviceadmin-servicelasso-localhost");
  const oidcMiddleware = plan.traefikDynamicConfig.middlewares.find((middleware) => middleware.name === "traefik-oidc-auth");
  const stripHeaders = plan.traefikDynamicConfig.middlewares.find((middleware) => middleware.name === "strip-browser-identity-headers");

  assert.ok(serviceAdminRouter);
  assert.deepEqual(serviceAdminRouter.middlewares, ["traefik-oidc-auth", "strip-browser-identity-headers"]);
  assert.equal(oidcMiddleware.kind, "oidc-plugin");
  assert.equal(oidcMiddleware.issuer, "https://zitadel.servicelasso.localhost");
  assert.ok(stripHeaders.removeRequestHeaders.includes("X-ServiceLasso-Audit-Actor"));
});

test("local SSO smoke contract covers protected route to ZITADEL callback loop", () => {
  const plan = buildLocalSsoBootstrapPlan();

  assert.deepEqual(
    plan.smokeCheck.map((step) => step.step),
    ["request_protected_route", "redirect_to_zitadel", "callback_to_oidc_middleware", "serviceadmin_authenticated"],
  );
  assert.equal(plan.smokeCheck[0].expect, "GET https://serviceadmin.servicelasso.localhost");
  assert.equal(plan.smokeCheck[1].expect, "https://zitadel.servicelasso.localhost");
  assert.equal(plan.smokeCheck[2].expect, "https://serviceadmin.servicelasso.localhost/oauth2/callback");
  assert.match(plan.smokeCheck[3].expect, /raw tokens absent/);
});

test("local SSO bootstrap rejects .local domains and inline secret values", () => {
  assert.throws(
    () =>
      assertSafeLocalSsoConfig({
        serviceAdminHost: "serviceadmin.servicelasso.local",
      }),
    /servicelasso\.localhost|\.local/,
  );

  assert.throws(
    () =>
      assertSafeLocalSsoConfig({
        oidcMiddleware: {
          clientSecretRef: "ACTUAL_SECRET",
        },
      }),
    /secretref:\/\//,
  );
});

test("local SSO bootstrap output is metadata-only and writable", async () => {
  const plan = buildLocalSsoBootstrapPlan();
  const text = JSON.stringify(plan);

  assert.doesNotMatch(text, forbiddenOutput);
  assert.doesNotMatch(text, new RegExp("auth " + "facade|" + "service-lasso" + "-auth", "i"));
  assert.equal(plan.secretRefs.every((ref) => ref.startsWith("secretref://")), true);

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-local-sso-"));
  try {
    const outputPath = path.join(tempRoot, "local-sso-bootstrap.plan.json");
    await writeLocalSsoBootstrapPlan(outputPath, plan);
    const written = await readFile(outputPath, "utf8");
    assert.match(written, /traefik-oidc-auth/);
    assert.doesNotMatch(written, forbiddenOutput);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
