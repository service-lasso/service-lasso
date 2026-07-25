import type {
  DiscoveredService,
  ServiceEndpointExposure,
  ServiceEndpointKind,
  ServiceEndpointPortStrategy,
  ServiceManifest,
  ServiceManifestEndpoint,
} from "../../contracts/service.js";

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

const DEFAULT_BIND = "127.0.0.1";

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
