import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const localSsoBootstrapDefaults = Object.freeze({
  hostSuffix: "servicelasso.localhost",
  serviceAdminHost: "serviceadmin.servicelasso.localhost",
  zitadelHost: "zitadel.servicelasso.localhost",
  traefikDashboardHost: "traefik.servicelasso.localhost",
  serviceAdminServiceUrl: "http://serviceadmin:${SERVICEADMIN_HTTP_PORT}",
  zitadelServiceUrl: "http://zitadel:${ZITADEL_HTTP_PORT}",
  oidcMiddleware: {
    serviceId: "traefik-oidc-auth",
    displayName: "Service Lasso Traefik OIDC middleware",
    issuer: "https://zitadel.servicelasso.localhost",
    callbackUri: "https://serviceadmin.servicelasso.localhost/oauth2/callback",
    postLogoutRedirectUri: "https://serviceadmin.servicelasso.localhost/",
    clientId: "service-lasso:traefik-oidc-auth",
    clientSecretRef: "secretref://@secretsbroker/zitadel/traefik-oidc-auth/client-secret",
    sessionSecretRef: "secretref://@secretsbroker/traefik-oidc-auth/session-secret",
    scopes: ["openid", "profile", "email"],
    forwardedIdentityHeaders: [
      "X-ServiceLasso-User-ID",
      "X-ServiceLasso-Email",
      "X-ServiceLasso-Roles",
      "X-ServiceLasso-Auth-Method",
      "X-ServiceLasso-Audit-Actor",
    ],
  },
  outputPath: "runtime/local-sso-bootstrap.plan.json",
});

const forbiddenSecretPatterns = [
  /BEGIN PRIVATE KEY/i,
  /access[_-]?token\s*[:=]/i,
  /refresh[_-]?token\s*[:=]/i,
  /id[_-]?token\s*[:=]/i,
  /session[_-]?cookie\s*[:=]/i,
  /client[_-]?secret\s*[:=]/i,
  /password\s*[:=]/i,
  /actual[_-]?secret/i,
];

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

export function normalizeLocalSsoConfig(config = {}) {
  const oidcMiddleware = {
    ...localSsoBootstrapDefaults.oidcMiddleware,
    ...(config.oidcMiddleware ?? {}),
  };

  return {
    ...localSsoBootstrapDefaults,
    ...config,
    oidcMiddleware: {
      ...oidcMiddleware,
      scopes: sortedUnique(oidcMiddleware.scopes ?? []),
      forwardedIdentityHeaders: sortedUnique(oidcMiddleware.forwardedIdentityHeaders ?? []),
    },
  };
}

export function assertSafeLocalSsoConfig(config = {}) {
  const normalized = normalizeLocalSsoConfig(config);
  const urls = [
    normalized.serviceAdminHost,
    normalized.zitadelHost,
    normalized.traefikDashboardHost,
    normalized.oidcMiddleware.issuer,
    normalized.oidcMiddleware.callbackUri,
    normalized.oidcMiddleware.postLogoutRedirectUri,
  ];

  for (const value of urls) {
    if (!String(value).includes("servicelasso.localhost")) {
      throw new Error(`Local SSO value must use servicelasso.localhost: ${value}`);
    }
    if (/\.local(\/|$)/.test(String(value))) {
      throw new Error(`Use servicelasso.localhost, not .local, for local SSO: ${value}`);
    }
  }

  for (const field of ["clientSecretRef", "sessionSecretRef"]) {
    const value = normalized.oidcMiddleware[field];
    if (!String(value).startsWith("secretref://")) {
      throw new Error(`${field} must be a secretref:// pointer, not inline secret material.`);
    }
  }

  const text = JSON.stringify(normalized);
  if (forbiddenSecretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error("Local SSO bootstrap config contains inline secret-like material.");
  }

  if (new RegExp("auth[-_ ]" + "facade", "i").test(text) || text.includes("service-lasso" + "-auth")) {
    throw new Error("Local SSO bootstrap must not introduce a core-owned auth gateway.");
  }

  return normalized;
}

export function buildLocalSsoBootstrapPlan(config = {}) {
  const safeConfig = assertSafeLocalSsoConfig(config);
  const middleware = safeConfig.oidcMiddleware;

  const routers = [
    {
      name: "serviceadmin-servicelasso-localhost",
      rule: `Host(\`${safeConfig.serviceAdminHost}\`)`,
      entryPoints: ["websecure"],
      tls: true,
      service: "serviceadmin",
      middlewares: [middleware.serviceId, "strip-browser-identity-headers"],
    },
    {
      name: "zitadel-servicelasso-localhost",
      rule: `Host(\`${safeConfig.zitadelHost}\`)`,
      entryPoints: ["websecure"],
      tls: true,
      service: "zitadel",
      middlewares: [],
    },
  ];

  const services = [
    { name: "serviceadmin", url: safeConfig.serviceAdminServiceUrl },
    { name: "zitadel", url: safeConfig.zitadelServiceUrl },
  ];

  const middlewares = [
    {
      name: middleware.serviceId,
      kind: "oidc-plugin",
      issuer: middleware.issuer,
      clientId: middleware.clientId,
      clientSecretRef: middleware.clientSecretRef,
      sessionSecretRef: middleware.sessionSecretRef,
      callbackUri: middleware.callbackUri,
      postLogoutRedirectUri: middleware.postLogoutRedirectUri,
      scopes: middleware.scopes,
      forwardedIdentityHeaders: middleware.forwardedIdentityHeaders,
    },
    {
      name: "strip-browser-identity-headers",
      kind: "headers",
      removeRequestHeaders: middleware.forwardedIdentityHeaders,
    },
  ];

  return {
    status: "ready-to-apply",
    ownerBoundary: "Traefik + traefik-oidc-auth + ZITADEL/service-owned config; no Service Lasso-owned OIDC/session/token facade.",
    domains: {
      serviceAdmin: `https://${safeConfig.serviceAdminHost}`,
      zitadel: `https://${safeConfig.zitadelHost}`,
      traefikDashboard: `https://${safeConfig.traefikDashboardHost}`,
    },
    traefikDynamicConfig: { routers, services, middlewares },
    zitadelClientRegistration: {
      serviceId: middleware.serviceId,
      displayName: middleware.displayName,
      issuer: middleware.issuer,
      clientId: middleware.clientId,
      redirectUris: [middleware.callbackUri],
      postLogoutRedirectUris: [middleware.postLogoutRedirectUri],
      allowedOrigins: [`https://${safeConfig.serviceAdminHost}`],
      clientSecretRef: middleware.clientSecretRef,
    },
    secretRefs: [middleware.clientSecretRef, middleware.sessionSecretRef],
    smokeCheck: [
      { step: "request_protected_route", expect: `GET https://${safeConfig.serviceAdminHost}` },
      { step: "redirect_to_zitadel", expect: middleware.issuer },
      { step: "callback_to_oidc_middleware", expect: middleware.callbackUri },
      { step: "serviceadmin_authenticated", expect: "trusted identity headers present; raw tokens absent" },
    ],
    diagnostics: [
      "verify *.servicelasso.localhost resolves to loopback",
      "verify local certificate covers servicelasso.localhost hosts",
      "verify ZITADEL ready endpoint before protected route smoke",
      "verify client/session secrets resolve through Secrets Broker refs",
    ],
  };
}

export function assertNoSecretMaterial(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (forbiddenSecretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error("Local SSO bootstrap output contains secret-like material.");
  }
  return true;
}

export async function writeLocalSsoBootstrapPlan(outputPath, plan) {
  assertNoSecretMaterial(plan);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

async function main() {
  const outputPath = process.env.SERVICE_LASSO_LOCAL_SSO_PLAN ?? localSsoBootstrapDefaults.outputPath;
  const plan = buildLocalSsoBootstrapPlan();
  await writeLocalSsoBootstrapPlan(outputPath, plan);
  console.log(JSON.stringify({ status: plan.status, outputPath, domains: plan.domains, secretRefs: plan.secretRefs }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
