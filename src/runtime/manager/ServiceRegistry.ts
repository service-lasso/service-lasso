import type { DiscoveredService } from "../../contracts/service.js";

export class ServiceRegistry {
  readonly #services: DiscoveredService[];
  readonly #servicesById: Map<string, DiscoveredService>;

  constructor(services: DiscoveredService[]) {
    this.#services = [...services];
    this.#servicesById = new Map(services.map((service) => [service.manifest.id, service]));
  }

  list(): DiscoveredService[] {
    return [...this.#services];
  }

  getById(serviceId: string): DiscoveredService | undefined {
    return this.#servicesById.get(serviceId);
  }

  count(): number {
    return this.#services.length;
  }

  countEnabled(): number {
    return this.#services.filter((service) => service.manifest.enabled !== false).length;
  }
}
