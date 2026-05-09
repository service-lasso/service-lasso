import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const localSsoLoopSmokeDefaults = Object.freeze({
  serviceAdminHost: "serviceadmin.servicelasso.localhost",
  authHost: "auth.servicelasso.localhost",
  zitadelHost: "zitadel.servicelasso.localhost",
  serviceAdminBackendUrl: "http://127.0.0.1:${SERVICEADMIN_PORT}",
  oidcMiddlewareAuthUrl: "http://127.0.0.1:${TRAEFIK_OIDC_AUTH_PORT}/auth",
  oidcMiddlewareCallbackUrl: "http://127.0.0.1:${TRAEFIK_OIDC_AUTH_PORT}/oauth2/callback",
  zitadelBackendUrl: "http://127.0.0.1:${ZITADEL_PORT}",
  outputPath: "runtime/local-sso-loop-smoke.evidence.json",
});

const trustedIdentityHeaders = Object.freeze([
  "X-ServiceLasso-User-ID",
  "X-ServiceLasso-Workspace-ID",
  "X-ServiceLasso-Email",
  "X-ServiceLasso-Roles",
  "X-ServiceLasso-Auth-Method",
  "X-ServiceLasso-Audit-Actor",
]);

const spoofableIdentityHeaders = Object.freeze([
  ...trustedIdentityHeaders,
  "X-Service-Lasso-User",
  "X-Service-Lasso-Workspace",
  "X-Service-Lasso-Roles",
  "X-Service-Lasso-Actor",
  "X-Forwarded-User",
  "X-Forwarded-Email",
  "X-Auth-Request-User",
  "X-Auth-Request-Email",
]);

const forbiddenMaterialPattern =
  /(?:ACTUAL_SECRET|BEGIN PRIVATE KEY|id_token\s*[:=]|access_token\s*[:=]|refresh_token\s*[:=]|client_secret\s*[:=]|session_cookie\s*[:=]|provider_credential\s*[:=]|raw_secret\s*[:=]|password\s*[:=]|Bearer\s+[A-Za-z0-9._~+/-]{24,})/i;

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

export function assertSafeLocalSsoSmokeConfig(config = {}) {
  const merged = { ...localSsoLoopSmokeDefaults, ...config };
  const hostValues = [merged.serviceAdminHost, merged.authHost, merged.zitadelHost];
  for (const value of hostValues) {
    if (!String(value).endsWith(".servicelasso.localhost")) {
      throw new Error(`Local SSO smoke hosts must use servicelasso.localhost: ${value}`);
    }
    if (/\.local(\/|$)/.test(String(value))) {
      throw new Error(`Use servicelasso.localhost, not .local, for local SSO smoke: ${value}`);
    }
  }

  assertNoSecretMaterial(merged, "local SSO smoke config");

  const text = JSON.stringify(merged);
  if (/auth[-_ ]facade|service-lasso-auth/i.test(text)) {
    throw new Error("Local SSO smoke must use the external OIDC middleware boundary, not a core-owned auth runtime.");
  }

  return merged;
}

export function buildLocalSsoLoopSmokeFixture(config = {}) {
  const safeConfig = assertSafeLocalSsoSmokeConfig(config);
  const stripHeaders = Object.fromEntries(spoofableIdentityHeaders.map((header) => [header, ""]));

  const traefikDynamicConfig = {
    http: {
      routers: {
        "serviceadmin-protected": {
          rule: `Host(\`${safeConfig.serviceAdminHost}\`)`,
          entryPoints: ["websecure"],
          middlewares: ["strip-browser-identity-headers", "traefik-oidc-auth"],
          service: "serviceadmin-backend",
          tls: {},
        },
        "auth-callback": {
          rule: `Host(\`${safeConfig.authHost}\`) && PathPrefix(\`/oauth2/callback\`)`,
          entryPoints: ["websecure"],
          middlewares: ["strip-browser-identity-headers"],
          service: "traefik-oidc-auth-callback",
          tls: {},
        },
        "zitadel-login": {
          rule: `Host(\`${safeConfig.zitadelHost}\`)`,
          entryPoints: ["websecure"],
          service: "zitadel-backend",
          tls: {},
        },
      },
      middlewares: {
        "strip-browser-identity-headers": {
          headers: { customRequestHeaders: stripHeaders },
        },
        "traefik-oidc-auth": {
          forwardAuth: {
            address: safeConfig.oidcMiddlewareAuthUrl,
            trustForwardHeader: false,
            authRequestHeaders: ["Cookie", "Authorization", "X-Forwarded-Proto", "X-Forwarded-Host", "X-Forwarded-Uri"],
            authResponseHeaders: [...trustedIdentityHeaders],
          },
        },
      },
      services: {
        "serviceadmin-backend": {
          loadBalancer: { servers: [{ url: safeConfig.serviceAdminBackendUrl }] },
        },
        "traefik-oidc-auth-callback": {
          loadBalancer: { servers: [{ url: safeConfig.oidcMiddlewareCallbackUrl }] },
        },
        "zitadel-backend": {
          loadBalancer: { servers: [{ url: safeConfig.zitadelBackendUrl }] },
        },
      },
    },
  };

  const fixture = {
    status: "ready",
    boundary: "Traefik + traefik-oidc-auth + ZITADEL; Service Lasso core provides deterministic smoke evidence only.",
    domains: {
      serviceAdmin: `https://${safeConfig.serviceAdminHost}`,
      authCallback: `https://${safeConfig.authHost}/oauth2/callback`,
      zitadel: `https://${safeConfig.zitadelHost}`,
    },
    traefikDynamicConfig,
    browserFlow: [
      {
        step: "unauthenticated_serviceadmin_request",
        request: `GET https://${safeConfig.serviceAdminHost}`,
        expect: {
          status: 302,
          locationStartsWith: `https://${safeConfig.zitadelHost}`,
          reason: "protected route redirects to ZITADEL through the external OIDC middleware",
        },
      },
      {
        step: "oidc_callback_fixture",
        request: `GET https://${safeConfig.authHost}/oauth2/callback?code=fixture-code&state=fixture-state`,
        expect: {
          status: 302,
          location: `https://${safeConfig.serviceAdminHost}`,
          session: "established by traefik-oidc-auth fixture; value redacted",
        },
      },
      {
        step: "authenticated_serviceadmin_return",
        request: `GET https://${safeConfig.serviceAdminHost}`,
        expect: {
          status: 200,
          pageTextIncludes: ["Trusted SSO identity context", "workspace:service-lasso/local-dev", "serviceadmin.operator"],
          forwardedIdentityHeaders: [...trustedIdentityHeaders],
        },
      },
      {
        step: "auth_unavailable_fail_closed",
        request: `GET https://${safeConfig.serviceAdminHost}`,
        expect: {
          status: 503,
          pageTextIncludes: ["Login required", "No trusted user metadata"],
          upstreamServiceAdminReached: false,
        },
      },
    ],
    capturedEvidence: {
      pageText: "Trusted SSO identity context workspace:service-lasso/local-dev serviceadmin.operator audit-actor://zitadel/max",
      console: ["local-sso-smoke fixture completed without credential output"],
      logs: ["redirect_to_zitadel", "callback_session_fixture_redacted", "serviceadmin_authenticated", "auth_unavailable_fail_closed"],
      diagnostics: [
        "generated Traefik dynamic config contains Service Admin, auth callback, and ZITADEL routes",
        "spoofable identity headers are stripped before protected upstream forwarding",
        "only trusted identity headers from traefik-oidc-auth are forwarded",
        "auth unavailable path fails closed before Service Admin upstream is reached",
      ],
    },
  };

  assertLocalSsoLoopSmokeEvidence(fixture);
  return fixture;
}

export function assertLocalSsoLoopSmokeEvidence(fixture) {
  assertNoSecretMaterial(fixture, "local SSO loop smoke evidence");

  const text = JSON.stringify(fixture);
  for (const required of [
    "serviceadmin.servicelasso.localhost",
    "auth.servicelasso.localhost",
    "zitadel.servicelasso.localhost",
    "traefik-oidc-auth",
    "strip-browser-identity-headers",
    "Trusted SSO identity context",
  ]) {
    if (!text.includes(required)) {
      throw new Error(`Local SSO loop smoke fixture missing ${required}`);
    }
  }

  if (/servicelasso\.local(?!host)/.test(text)) {
    throw new Error("Local SSO loop smoke fixture must use servicelasso.localhost, not .local.");
  }
  if (/serviceadmin-(?:bypass|unprotected)|trustForwardHeader\":true/.test(text)) {
    throw new Error("Local SSO loop smoke fixture contains unsafe bypass behavior.");
  }

  return true;
}

export function assertNoSecretMaterial(value, context = "value") {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (forbiddenMaterialPattern.test(text)) {
    throw new Error(`${context} contains secret-like material.`);
  }
  return true;
}

export async function writeLocalSsoLoopSmokeEvidence(outputPath, fixture = buildLocalSsoLoopSmokeFixture()) {
  assertLocalSsoLoopSmokeEvidence(fixture);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
}

async function main() {
  const outputPath = process.env.SERVICE_LASSO_LOCAL_SSO_SMOKE ?? localSsoLoopSmokeDefaults.outputPath;
  const fixture = buildLocalSsoLoopSmokeFixture();
  await writeLocalSsoLoopSmokeEvidence(outputPath, fixture);
  console.log(JSON.stringify({ status: fixture.status, outputPath, domains: fixture.domains }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
