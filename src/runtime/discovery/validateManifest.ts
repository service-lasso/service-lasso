import type { ServiceManifest } from "../../contracts/service.js";

function expectNonEmptyString(value: unknown, field: string, manifestPath: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected non-empty string for \"${field}\".`);
  }

  return value.trim();
}

export function validateServiceManifest(input: unknown, manifestPath: string): ServiceManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected a JSON object.`);
  }

  const record = input as Record<string, unknown>;

  return {
    id: expectNonEmptyString(record.id, "id", manifestPath),
    name: expectNonEmptyString(record.name, "name", manifestPath),
    description: expectNonEmptyString(record.description, "description", manifestPath),
    version: typeof record.version === "string" ? record.version : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
  };
}
