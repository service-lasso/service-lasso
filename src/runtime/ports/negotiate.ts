import net from "node:net";
import type { DiscoveredService } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";

const DEFAULT_DYNAMIC_PORT_START = 4000;
const DEFAULT_PORT_HOST = "127.0.0.1";

function parseOptionalPortRange(): { start: number; end: number } | null {
  const startValue = process.env.SERVICE_LASSO_PORT_RANGE_START;
  const endValue = process.env.SERVICE_LASSO_PORT_RANGE_END;
  if (startValue === undefined && endValue === undefined) return null;

  const start = Number(startValue);
  const end = Number(endValue);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start || end > 65535) {
    throw new Error(`Invalid SERVICE_LASSO_PORT_RANGE_START/END range: ${startValue}-${endValue}.`);
  }
  return { start, end };
}

function isUsablePort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;
}

function isPortInsideRange(port: number, range: { start: number; end: number } | null): boolean {
  return !range || (port >= range.start && port <= range.end);
}

function nextCandidatePort(preferredPort: number, range: { start: number; end: number } | null): number {
  if (range) {
    return preferredPort >= range.start && preferredPort <= range.end ? preferredPort : range.start;
  }
  return preferredPort === 0 ? DEFAULT_DYNAMIC_PORT_START : preferredPort;
}

async function isPortFree(port: number, host = DEFAULT_PORT_HOST): Promise<boolean> {
  const server = net.createServer();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }).catch(() => undefined);
    }
  }
}

function collectReservedPorts(services: DiscoveredService[], currentServiceId: string): Set<number> {
  const reservedPorts = new Set<number>();

  for (const service of services) {
    const state = getLifecycleState(service.manifest.id);
    for (const port of Object.values(state.runtime.ports)) {
      if (service.manifest.id !== currentServiceId && isUsablePort(port)) {
        reservedPorts.add(port);
      }
    }
  }

  return reservedPorts;
}

export async function negotiateServicePorts(
  service: DiscoveredService,
  services: DiscoveredService[],
): Promise<Record<string, number>> {
  const desiredPorts = service.manifest.ports ?? {};
  const currentPorts = getLifecycleState(service.manifest.id).runtime.ports;
  const negotiatedPorts: Record<string, number> = {};
  const reservedPorts = collectReservedPorts(services, service.manifest.id);
  const portRange = parseOptionalPortRange();

  for (const [name, desiredPort] of Object.entries(desiredPorts)) {
    const existingPort = currentPorts[name];
    if (isUsablePort(existingPort) && isPortInsideRange(existingPort, portRange)) {
      negotiatedPorts[name] = existingPort;
      reservedPorts.add(existingPort);
      continue;
    }

    let candidatePort = nextCandidatePort(desiredPort, portRange);
    const maxCandidatePort = portRange?.end ?? 65535;
    while (reservedPorts.has(candidatePort) || !(await isPortFree(candidatePort))) {
      candidatePort += 1;
      if (candidatePort > maxCandidatePort) {
        const rangeLabel = portRange ? ` in configured range ${portRange.start}-${portRange.end}` : "";
        throw new Error(`Unable to negotiate a free port${rangeLabel} for service "${service.manifest.id}" port "${name}".`);
      }
    }

    negotiatedPorts[name] = candidatePort;
    reservedPorts.add(candidatePort);
  }

  return negotiatedPorts;
}
