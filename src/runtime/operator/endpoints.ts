import type {
  DiscoveredService,
  ServiceEndpointExposure,
  ServiceEndpointKind,
  ServiceEndpointPortStrategy,
  ServiceManifest,
  ServiceManifestEndpoint,
} from "../../contracts/service.js";
import { composeServiceLassoLocalHostname } from "../traefik/local-route-generation.js";

export interface ResolvedServiceEndpoint {
  id: string;
  kind: ServiceEndpointKind;
  label: string;
  direction?: string;
  transport?: string;
  protocol?: string;
  bind?: string;
  port?: number;
  portDefault?: number;
  portStrategy?: ServiceEndpointPortStrategy;
  target?: string;
  url?: string;
  exposure?: ServiceEndpointExposure;
  required?: boolean;
  primary?: boolean;
  source: "manifest.endpoints" | "manifest.ports" | "manifest.urls" | "manifest.portmapping" | "healthcheck";
}

export interface EndpointVariable {
  key: string;
  value: string;
}

export type EffectiveServiceRouteProvider =
  | "service-lasso-runtime"
  | "traefik"
  | "unsupported"
  | "unavailable";

export type EffectiveServiceRouteState =
  | "active"
  | "pending"
  | "degraded"
  | "invalid"
  | "unavailable"
  | "unknown";

export type EffectiveServiceRouteConfigSource =
  | "service-manifest"
  | "runtime-default"
  | "generated-config"
  | "unavailable"
  | "invalid";

export interface EffectiveServiceRouteMetadata {
  serviceId: string;
  serviceName: string;
  endpoint: {
    id: string;
    label: string;
    kind: ServiceEndpointKind;
    source: ResolvedServiceEndpoint["source"];
  };
  exposure: ServiceEndpointExposure;
  provider: EffectiveServiceRouteProvider;
  target: {
    bind?: string;
    port?: number;
    protocol?: string;
    host?: string;
    path?: string;
    pathPrefix?: string;
  };
  traefik?: {
    routerName: string;
    serviceName: string;
    middlewareNames: string[];
    entryPoints: string[];
    tls: "enabled" | "disabled";
    rule: string;
  };
  configSource: EffectiveServiceRouteConfigSource;
  state: EffectiveServiceRouteState;
  diagnostics: string[];
  nextAction: string;
}

export interface EffectiveServiceRouteMetadataSummary {
  contractVersion: "service-lasso.route-metadata.v1";
  routes: EffectiveServiceRouteMetadata[];
}

const DEFAULT_BIND = "127.0.0.1";
const forbiddenMaterialPattern =
  /(?:id_token|access_token|refresh_token|client_secret|session_cookie|password|private[_-]?key|Bearer\s+[A-Za-z0-9._~+/-]{24,}|gh[pousr]_[A-Za-z0-9_]{30,})/i;

export function endpointUrlFromNetwork(
  protocol: string | undefined,
  bind: string | undefined,
  port: number | undefined,
): string | undefined {
  if (port === undefined) {
    return undefined;
  }

  const safeProtocol = protocol === "http" || protocol === "https" ? protocol : "tcp";
  return `${safeProtocol}://${bind ?? DEFAULT_BIND}:${port}/`;
}

function endpointIdFromLabel(label: string): string {
  return label
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function uniqueEndpointId(baseId: string, endpoints: Map<string, ResolvedServiceEndpoint>): string {
  if (!endpoints.has(baseId)) {
    return baseId;
  }

  let counter = 1;
  let candidate = `${baseId}_url`;
  while (endpoints.has(candidate)) {
    counter += 1;
    candidate = `${baseId}_url_${counter}`;
  }

  return candidate;
}

function isUsablePort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;
}

function servicePortSelectorName(portName: string): string {
  return `${portName.trim().replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_PORT`;
}

function portmappingAliasTarget(value: string | number, portNames: Set<string>): string | null {
  const match = String(value).trim().match(/^\$\{([^}]+)\}$/);
  if (!match) {
    return null;
  }

  const selector = match[1].trim();
  for (const portName of portNames) {
    const legacySelector = servicePortSelectorName(portName);
    if (selector === legacySelector || (portName === "service" && selector === "SERVICE_PORT")) {
      return portName;
    }
  }
  return null;
}

function endpointFromManifest(entry: ServiceManifestEndpoint): ResolvedServiceEndpoint {
  const strategy = entry.port?.strategy ?? entry.port?.policy;
  return {
    id: entry.id,
    kind: entry.kind,
    label: entry.label ?? entry.id,
    direction: entry.direction,
    transport: entry.transport,
    protocol: entry.protocol,
    bind: entry.bind,
    portDefault: entry.port?.default,
    portStrategy: strategy,
    target: entry.target,
    url: entry.url,
    exposure: entry.exposure,
    required: entry.required,
    primary: entry.primary,
    source: "manifest.endpoints",
  };
}

export function normalizeServiceEndpoints(manifest: ServiceManifest): ResolvedServiceEndpoint[] {
  const endpoints = new Map<string, ResolvedServiceEndpoint>();

  for (const entry of manifest.endpoints ?? []) {
    endpoints.set(entry.id, endpointFromManifest(entry));
  }

  for (const [name, port] of Object.entries(manifest.ports ?? {})) {
    if (!endpoints.has(name)) {
      endpoints.set(name, {
        id: name,
        kind: "network",
        label: name,
        direction: "inbound",
        transport: "tcp",
        protocol: "tcp",
        bind: DEFAULT_BIND,
        portDefault: port,
        portStrategy: port === 0 ? "automatic" : "preferred",
        exposure: "local",
        source: "manifest.ports",
      });
    }
  }

  const portNames = new Set(Object.keys(manifest.ports ?? {}));
  for (const [name, value] of Object.entries(manifest.portmapping ?? {})) {
    if (portmappingAliasTarget(value, portNames)) {
      continue;
    }

    const id = endpointIdFromLabel(name);
    const renderedValue = String(value).trim();
    if (!endpoints.has(id) && /^\d+$/.test(renderedValue)) {
      endpoints.set(id, {
        id,
        kind: "network",
        label: name,
        direction: "inbound",
        transport: "tcp",
        protocol: "tcp",
        bind: DEFAULT_BIND,
        portDefault: Number(renderedValue),
        portStrategy: "preferred",
        exposure: "local",
        source: "manifest.portmapping",
      });
    }
  }

  for (const entry of manifest.urls ?? []) {
    const id = uniqueEndpointId(endpointIdFromLabel(entry.label), endpoints);
    endpoints.set(id, {
      id,
      kind: "url",
      label: entry.label,
      protocol: entry.url.startsWith("https:") ? "https" : entry.url.startsWith("http:") ? "http" : undefined,
      url: entry.url,
      exposure: entry.kind === "lan" || entry.kind === "public" ? entry.kind : "local",
      source: "manifest.urls",
    });
  }

  return [...endpoints.values()];
}

export function resolveServiceEndpoints(
  service: DiscoveredService,
  resolvedPorts: Record<string, number> = service.manifest.ports ?? {},
): ResolvedServiceEndpoint[] {
  return normalizeServiceEndpoints(service.manifest).map((endpoint) => ({
    ...endpoint,
    port: endpoint.kind === "network" ? resolvedPorts[endpoint.id] ?? endpoint.portDefault : endpoint.port,
  }));
}

export function buildEffectiveRouteMetadata(
  service: DiscoveredService,
  resolvedPorts: Record<string, number> = service.manifest.ports ?? {},
): EffectiveServiceRouteMetadataSummary {
  return {
    contractVersion: "service-lasso.route-metadata.v1",
    routes: resolveServiceEndpoints(service, resolvedPorts).map((endpoint) =>
      buildEffectiveRouteMetadataEntry(service, endpoint),
    ),
  };
}

function buildEffectiveRouteMetadataEntry(
  service: DiscoveredService,
  endpoint: ResolvedServiceEndpoint,
): EffectiveServiceRouteMetadata {
  const diagnostics: string[] = [];
  const exposure = endpoint.exposure ?? "local";
  const base = {
    serviceId: safeMetadataText(service.manifest.id, "redacted-service-id"),
    serviceName: safeMetadataText(service.manifest.name, "redacted-service"),
    endpoint: {
      id: safeMetadataText(endpoint.id, "redacted-endpoint"),
      label: safeMetadataText(endpoint.label, "redacted endpoint"),
      kind: endpoint.kind,
      source: endpoint.source,
    },
    exposure,
    target: {},
    diagnostics,
  };

  if (endpoint.kind === "network") {
    const protocol = endpoint.protocol ?? endpoint.transport ?? "tcp";
    const target = {
      bind: safeMetadataText(endpoint.bind ?? DEFAULT_BIND, DEFAULT_BIND),
      port: endpoint.port,
      protocol,
    };

    if (!isUsablePort(endpoint.port)) {
      diagnostics.push(endpoint.portStrategy === "automatic"
        ? "Route is waiting for runtime port negotiation."
        : "Route has no usable target port.");
      return {
        ...base,
        target,
        provider: "unavailable",
        configSource: endpoint.portStrategy === "automatic" ? "runtime-default" : "unavailable",
        state: endpoint.portStrategy === "automatic" ? "pending" : "unavailable",
        nextAction: endpoint.portStrategy === "automatic"
          ? "Start or prepare the service so Service Lasso can allocate the endpoint port."
          : "Add a valid service manifest endpoint port or runtime port reservation.",
      };
    }

    if (exposure !== "local" && protocol !== "http" && protocol !== "https") {
      diagnostics.push("Traefik route metadata is available only for HTTP and HTTPS endpoints.");
      return {
        ...base,
        target,
        provider: "unsupported",
        configSource: "service-manifest",
        state: "degraded",
        nextAction: "Expose a HTTP/HTTPS endpoint or keep this endpoint runtime-local.",
      };
    }

    const traefik = protocol === "http" || protocol === "https"
      ? buildTraefikRouteIntent(service.manifest.id, endpoint)
      : undefined;

    return {
      ...base,
      target,
      ...(traefik ? { traefik } : {}),
      provider: traefik && exposure !== "local" ? "traefik" : "service-lasso-runtime",
      configSource: traefik && exposure !== "local" ? "generated-config" : "service-manifest",
      state: "active",
      nextAction: traefik && exposure !== "local"
        ? "Publish the generated Traefik route config when proxy deployment is enabled."
        : "Use the runtime-local endpoint directly or opt into Traefik exposure in the service manifest.",
    };
  }

  if (endpoint.kind === "url") {
    const parsed = parseSafeRouteUrl(endpoint.url);
    if (!parsed.ok) {
      diagnostics.push(parsed.reason);
      return {
        ...base,
        target: {},
        provider: "unavailable",
        configSource: parsed.invalid ? "invalid" : "unavailable",
        state: parsed.invalid ? "invalid" : "unavailable",
        nextAction: parsed.invalid
          ? "Replace the route URL with metadata-only host/path information before exposing it."
          : "Add a URL or target endpoint to the service manifest route declaration.",
      };
    }

    return {
      ...base,
      target: parsed.target,
      provider: "service-lasso-runtime",
      configSource: "service-manifest",
      state: "active",
      nextAction: "Use this manifest URL as a metadata route; no Traefik config is generated for static URL entries.",
    };
  }

  diagnostics.push("This endpoint kind does not produce runtime route metadata.");
  return {
    ...base,
    target: {},
    provider: "unsupported",
    configSource: "service-manifest",
    state: "unknown",
    nextAction: "Use network or URL endpoints for operator-visible route metadata.",
  };
}

function buildTraefikRouteIntent(
  serviceId: string,
  endpoint: ResolvedServiceEndpoint,
): EffectiveServiceRouteMetadata["traefik"] {
  const appName = sanitizeRouteResourceName(`${serviceId}-${endpoint.id}`);
  const middlewares = [
    "servicelasso-strip-spoofed-identity",
    "servicelasso-forward-auth",
  ];
  return {
    routerName: `${appName}-servicelasso-local`,
    serviceName: `${appName}-backend`,
    middlewareNames: middlewares,
    entryPoints: ["websecure"],
    tls: "enabled",
    rule: `Host(\`${composeServiceLassoLocalHostname(`${serviceId}-${endpoint.id}`)}\`)`,
  };
}

function parseSafeRouteUrl(url: string | undefined): {
  ok: true;
  target: EffectiveServiceRouteMetadata["target"];
} | {
  ok: false;
  invalid: boolean;
  reason: string;
} {
  if (!url) {
    return { ok: false, invalid: false, reason: "Manifest URL route has no URL." };
  }
  if (forbiddenMaterialPattern.test(url)) {
    return { ok: false, invalid: true, reason: "Manifest URL route contains secret-like material and was not serialized." };
  }
  try {
    const parsed = new URL(url);
    return {
      ok: true,
      target: {
        protocol: parsed.protocol.replace(/:$/, ""),
        host: safeMetadataText(parsed.host, "redacted-host"),
        path: safeMetadataText(parsed.pathname || "/", "/"),
        pathPrefix: safeMetadataText(firstPathSegment(parsed.pathname), "/"),
      },
    };
  } catch {
    return { ok: false, invalid: true, reason: "Manifest URL route is not a valid URL." };
  }
}

function firstPathSegment(pathname: string): string {
  const [segment] = pathname.split("/").filter(Boolean);
  return segment ? `/${segment}` : "/";
}

function safeMetadataText(value: string, fallback: string): string {
  return forbiddenMaterialPattern.test(value) ? fallback : value;
}

function sanitizeRouteResourceName(value: string): string {
  const name = value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "route";
}

export function buildEndpointVariables(
  service: DiscoveredService,
  resolvedPorts: Record<string, number> = service.manifest.ports ?? {},
): EndpointVariable[] {
  const variables: EndpointVariable[] = [];
  const values = new Map<string, string>();
  const endpoints = resolveServiceEndpoints(service, resolvedPorts);
  const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));

  for (const endpoint of endpoints) {
    const url = endpoint.url ?? endpointUrlFromNetwork(endpoint.protocol, endpoint.bind, endpoint.port);
    const fields: Record<string, string | number | undefined> = {
      id: endpoint.id,
      kind: endpoint.kind,
      label: endpoint.label,
      bind: endpoint.bind,
      host: endpoint.bind,
      port: isUsablePort(endpoint.port) ? endpoint.port : undefined,
      protocol: endpoint.protocol,
      transport: endpoint.transport,
      target: endpoint.target,
      url,
      exposure: endpoint.exposure,
    };

    for (const [field, value] of Object.entries(fields)) {
      if (value !== undefined) {
        const key = `endpoint.${endpoint.id}.${field}`;
        values.set(key, String(value));
      }
    }
  }

  for (const endpoint of endpoints) {
    if (endpoint.kind !== "url" || endpoint.url || !endpoint.target) {
      continue;
    }

    const target = endpointsById.get(endpoint.target);
    const targetUrl = target
      ? values.get(`endpoint.${target.id}.url`) ?? endpointUrlFromNetwork(target.protocol, target.bind, target.port)
      : undefined;
    if (targetUrl) {
      values.set(`endpoint.${endpoint.id}.url`, targetUrl);
    }
  }

  for (const [key, value] of values) {
    const rendered = value.replace(/\$\{([^}]+)\}/g, (match, selector) => values.get(selector.trim()) ?? match);
    values.set(key, rendered);
    variables.push({ key, value: rendered });
  }

  return variables.map((entry) => ({
    key: entry.key,
    value: entry.value.replace(/\$\{([^}]+)\}/g, (match, selector) => values.get(selector.trim()) ?? match),
  }));
}
