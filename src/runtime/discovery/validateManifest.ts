import type { ServiceManifest } from "../../contracts/service.js";
import type { ServiceHealthcheck } from "../health/types.js";

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

  const dependOn = record.depend_on;
  if (
    dependOn !== undefined &&
    (!Array.isArray(dependOn) || dependOn.some((dependency) => typeof dependency !== "string" || dependency.trim().length === 0))
  ) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected \"depend_on\" to be an array of non-empty strings.`);
  }

  const rawHealthcheck = record.healthcheck;
  let healthcheck: ServiceHealthcheck | undefined;

  if (rawHealthcheck !== undefined) {
    if (!rawHealthcheck || typeof rawHealthcheck !== "object" || Array.isArray(rawHealthcheck)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected \"healthcheck\" to be an object.`);
    }

    const healthRecord = rawHealthcheck as Record<string, unknown>;
    if (healthRecord.type === "process") {
      healthcheck = { type: "process" };
    } else if (healthRecord.type === "http") {
      healthcheck = {
        type: "http",
        url: expectNonEmptyString(healthRecord.url, "healthcheck.url", manifestPath),
        expected_status:
          typeof healthRecord.expected_status === "number" ? healthRecord.expected_status : undefined,
      };
    } else {
      throw new Error(`Invalid service manifest at ${manifestPath}: unsupported healthcheck type.`);
    }
  }

  return {
    id: expectNonEmptyString(record.id, "id", manifestPath),
    name: expectNonEmptyString(record.name, "name", manifestPath),
    description: expectNonEmptyString(record.description, "description", manifestPath),
    version: typeof record.version === "string" ? record.version : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    depend_on: dependOn?.map((dependency) => dependency.trim()),
    healthcheck,
  };
}
