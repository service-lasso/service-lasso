export interface ServiceLassoLocalAppRoute {
  appId: string;
  serviceId: string;
  backendUrl: string;
  protected?: boolean;
  authMiddleware?: string;
  extraMiddlewares?: string[];
}

export interface ServiceLassoTraefikRouteOptions {
  domainSuffix?: string;
  namespace?: string;
  entryPoint?: string;
  tls?: boolean;
  defaultAuthMiddleware?: string;
}

export interface ServiceLassoTraefikDynamicConfig {
  http: {
    routers: Record<string, TraefikRouterConfig>;
    services: Record<string, TraefikServiceConfig>;
    middlewares: Record<string, TraefikMiddlewareConfig>;
  };
}

export interface TraefikRouterConfig {
  rule: string;
  entryPoints: string[];
  middlewares?: string[];
  service: string;
  tls?: Record<string, never>;
}

export interface TraefikServiceConfig {
  loadBalancer: {
    servers: Array<{ url: string }>;
  };
}

export type TraefikMiddlewareConfig =
  | {
      forwardAuth: {
        address: string;
        trustForwardHeader: false;
        authRequestHeaders: string[];
        authResponseHeaders: string[];
      };
    }
  | {
      headers: {
        customRequestHeaders?: Record<string, string>;
        customResponseHeaders?: Record<string, string>;
      };
    };

const defaultIdentityHeadersToStrip = [
  "X-ServiceLasso-User-ID",
  "X-ServiceLasso-Workspace-ID",
  "X-ServiceLasso-Instance-ID",
  "X-ServiceLasso-Email",
  "X-ServiceLasso-Roles",
  "X-ServiceLasso-Auth-Method",
  "X-ServiceLasso-Audit-Actor",
  "X-Service-Lasso-User",
  "X-Service-Lasso-Workspace",
  "X-Service-Lasso-Roles",
  "X-Service-Lasso-Actor",
  "X-Forwarded-User",
  "X-Forwarded-Email",
  "X-Auth-Request-User",
  "X-Auth-Request-Email",
];

const trustedIdentityHeaders = [
  "X-ServiceLasso-User-ID",
  "X-ServiceLasso-Workspace-ID",
  "X-ServiceLasso-Instance-ID",
  "X-ServiceLasso-Email",
  "X-ServiceLasso-Roles",
  "X-ServiceLasso-Auth-Method",
  "X-ServiceLasso-Audit-Actor",
];

const forbiddenMaterialPattern =
  /(?:id_token|access_token|refresh_token|client_secret|session_cookie|password|private[_-]?key|Bearer\s+[A-Za-z0-9._~+/-]{24,}|gh[pousr]_[A-Za-z0-9_]{30,})/i;

export function composeServiceLassoLocalHostname(
  appId: string,
  options: ServiceLassoTraefikRouteOptions = {},
): string {
  const namespace = sanitizeDnsLabel(options.namespace ?? "servicelasso");
  const suffix = sanitizeDomainSuffix(options.domainSuffix ?? "localhost");
  const app = sanitizeDnsLabel(appId);
  return `${app}.${namespace}.${suffix}`;
}

export function buildServiceLassoTraefikDynamicConfig(
  routes: ServiceLassoLocalAppRoute[],
  options: ServiceLassoTraefikRouteOptions = {},
): ServiceLassoTraefikDynamicConfig {
  const entryPoint = options.entryPoint ?? "websecure";
  const tls = options.tls ?? true;
  const defaultAuthMiddleware = sanitizeResourceName(
    options.defaultAuthMiddleware ?? "servicelasso-forward-auth",
  );
  const routers: Record<string, TraefikRouterConfig> = {};
  const services: Record<string, TraefikServiceConfig> = {};
  const middlewares: Record<string, TraefikMiddlewareConfig> = {
    "servicelasso-strip-spoofed-identity": {
      headers: {
        customRequestHeaders: Object.fromEntries(
          defaultIdentityHeadersToStrip.map((header) => [header, ""]),
        ),
      },
    },
    [defaultAuthMiddleware]: {
      forwardAuth: {
        address: "http://127.0.0.1:${AUTH_FACADE_PORT}/forward-auth",
        trustForwardHeader: false,
        authRequestHeaders: [
          "Cookie",
          "Authorization",
          "X-Forwarded-Proto",
          "X-Forwarded-Host",
          "X-Forwarded-Uri",
        ],
        authResponseHeaders: trustedIdentityHeaders,
      },
    },
  };

  for (const route of routes) {
    const appName = sanitizeResourceName(route.appId);
    const routerName = `${appName}-servicelasso-local`;
    const serviceName = `${appName}-backend`;
    const protectedRoute = route.protected !== false;
    const middlewaresForRoute = protectedRoute
      ? [
          "servicelasso-strip-spoofed-identity",
          sanitizeResourceName(route.authMiddleware ?? defaultAuthMiddleware),
          ...dedupe((route.extraMiddlewares ?? []).map(sanitizeResourceName)),
        ]
      : dedupe((route.extraMiddlewares ?? []).map(sanitizeResourceName));

    assertNoSecretLikeMaterial(
      route.backendUrl,
      `backendUrl for ${route.appId}`,
    );
    routers[routerName] = {
      rule: `Host(\`${composeServiceLassoLocalHostname(route.appId, options)}\`)`,
      entryPoints: [entryPoint],
      ...(middlewaresForRoute.length > 0
        ? { middlewares: middlewaresForRoute }
        : {}),
      service: serviceName,
      ...(tls ? { tls: {} } : {}),
    };
    services[serviceName] = {
      loadBalancer: { servers: [{ url: route.backendUrl }] },
    };
  }

  const config = { http: { routers, services, middlewares } };
  assertNoSecretLikeMaterial(
    JSON.stringify(config),
    "generated Traefik dynamic config",
  );
  return config;
}

export function renderServiceLassoTraefikDynamicConfigYaml(
  config: ServiceLassoTraefikDynamicConfig,
): string {
  const lines = ["http:", "  routers:"];
  for (const [name, router] of Object.entries(config.http.routers)) {
    lines.push(`    ${name}:`);
    lines.push(`      rule: "${router.rule}"`);
    lines.push("      entryPoints:");
    for (const entryPoint of router.entryPoints)
      lines.push(`        - ${entryPoint}`);
    if (router.middlewares && router.middlewares.length > 0) {
      lines.push("      middlewares:");
      for (const middleware of router.middlewares)
        lines.push(`        - ${middleware}`);
    }
    lines.push(`      service: ${router.service}`);
    if (router.tls) lines.push("      tls: {}");
  }
  lines.push("  middlewares:");
  for (const [name, middleware] of Object.entries(config.http.middlewares)) {
    lines.push(`    ${name}:`);
    if ("forwardAuth" in middleware) {
      lines.push("      forwardAuth:");
      lines.push(`        address: "${middleware.forwardAuth.address}"`);
      lines.push(
        `        trustForwardHeader: ${middleware.forwardAuth.trustForwardHeader}`,
      );
      lines.push("        authRequestHeaders:");
      for (const header of middleware.forwardAuth.authRequestHeaders)
        lines.push(`          - ${header}`);
      lines.push("        authResponseHeaders:");
      for (const header of middleware.forwardAuth.authResponseHeaders)
        lines.push(`          - ${header}`);
    } else {
      lines.push("      headers:");
      if (middleware.headers.customRequestHeaders) {
        lines.push("        customRequestHeaders:");
        for (const [header, value] of Object.entries(
          middleware.headers.customRequestHeaders,
        )) {
          lines.push(`          ${header}: "${value}"`);
        }
      }
      if (middleware.headers.customResponseHeaders) {
        lines.push("        customResponseHeaders:");
        for (const [header, value] of Object.entries(
          middleware.headers.customResponseHeaders,
        )) {
          lines.push(`          ${header}: "${value}"`);
        }
      }
    }
  }
  lines.push("  services:");
  for (const [name, service] of Object.entries(config.http.services)) {
    lines.push(`    ${name}:`);
    lines.push("      loadBalancer:");
    lines.push("        servers:");
    for (const server of service.loadBalancer.servers)
      lines.push(`          - url: "${server.url}"`);
  }
  const yaml = `${lines.join("\n")}\n`;
  assertNoSecretLikeMaterial(yaml, "rendered Traefik dynamic config YAML");
  return yaml;
}

function sanitizeDnsLabel(value: string): string {
  const label = value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!label) throw new Error("Local route host label cannot be empty.");
  if (label === "local")
    throw new Error("Use the .localhost suffix, not .local.");
  return label;
}

function sanitizeDomainSuffix(value: string): string {
  const suffix = value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
  if (suffix !== "localhost")
    throw new Error(
      `Service Lasso local routes must use localhost suffix, got ${suffix}.`,
    );
  return suffix;
}

function sanitizeResourceName(value: string): string {
  const name = value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name) throw new Error("Traefik resource name cannot be empty.");
  return name;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function assertNoSecretLikeMaterial(value: string, context: string): void {
  if (forbiddenMaterialPattern.test(value)) {
    throw new Error(`${context} contains secret-like material.`);
  }
}
