import type { ServiceManifest } from "../../contracts/service.js";
import type { ServiceHealthcheck } from "../health/types.js";

function expectNonEmptyString(value: unknown, field: string, manifestPath: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected non-empty string for \"${field}\".`);
  }

  return value.trim();
}

function expectOptionalWholeNumber(
  value: unknown,
  field: string,
  manifestPath: string,
  minimum = 0,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: expected "${field}" to be an integer greater than or equal to ${minimum}.`,
    );
  }

  return value;
}

function readHealthcheckReadinessOptions(
  healthRecord: Record<string, unknown>,
  manifestPath: string,
): Record<string, number> {
  const interval = expectOptionalWholeNumber(healthRecord.interval, "healthcheck.interval", manifestPath, 1);
  const retries = expectOptionalWholeNumber(healthRecord.retries, "healthcheck.retries", manifestPath, 1);
  const startPeriod = expectOptionalWholeNumber(
    healthRecord.start_period,
    "healthcheck.start_period",
    manifestPath,
    0,
  );

  return {
    ...(interval !== undefined ? { interval } : {}),
    ...(retries !== undefined ? { retries } : {}),
    ...(startPeriod !== undefined ? { start_period: startPeriod } : {}),
  };
}

function readActionMaterialization(
  value: unknown,
  field: "install" | "config",
  manifestPath: string,
): ServiceManifest["install"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  if (
    record.files !== undefined &&
    (!Array.isArray(record.files) ||
      record.files.some(
        (entry) =>
          !entry ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          typeof (entry as Record<string, unknown>).path !== "string" ||
          typeof (entry as Record<string, unknown>).content !== "string",
      ))
  ) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: expected "${field}.files" to be an array of { path, content } objects.`,
    );
  }

  if (!record.files) {
    return {};
  }

  return {
    files: record.files.map((entry) => ({
      path: expectNonEmptyString((entry as Record<string, string>).path, `${field}.files.path`, manifestPath),
      content: (entry as Record<string, string>).content,
    })),
  };
}

function readArtifact(value: unknown, manifestPath: string): ServiceManifest["artifact"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "artifact" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  if (record.kind !== "archive") {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "artifact.kind" to be "archive".`);
  }

  if (!record.source || typeof record.source !== "object" || Array.isArray(record.source)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "artifact.source" to be an object.`);
  }

  const sourceRecord = record.source as Record<string, unknown>;
  if (sourceRecord.type !== "github-release") {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: expected "artifact.source.type" to be "github-release".`,
    );
  }

  if (!record.platforms || typeof record.platforms !== "object" || Array.isArray(record.platforms)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "artifact.platforms" to be an object.`);
  }

  const platformEntries = Object.entries(record.platforms as Record<string, unknown>);
  if (platformEntries.length === 0) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "artifact.platforms" to define at least one platform entry.`);
  }

  const platforms = Object.fromEntries(
    platformEntries.map(([platform, candidate]) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}" to be an object.`,
        );
      }

      const platformRecord = candidate as Record<string, unknown>;
      const archiveType = platformRecord.archiveType;
      if (archiveType !== "zip" && archiveType !== "tar.gz" && archiveType !== "tgz") {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}.archiveType" to be one of "zip", "tar.gz", or "tgz".`,
        );
      }

      if (
        platformRecord.assetName !== undefined &&
        (typeof platformRecord.assetName !== "string" || platformRecord.assetName.trim().length === 0)
      ) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}.assetName" to be a non-empty string when present.`,
        );
      }

      if (
        platformRecord.assetUrl !== undefined &&
        (typeof platformRecord.assetUrl !== "string" || platformRecord.assetUrl.trim().length === 0)
      ) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}.assetUrl" to be a non-empty string when present.`,
        );
      }

      if (
        platformRecord.command !== undefined &&
        (typeof platformRecord.command !== "string" || platformRecord.command.trim().length === 0)
      ) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}.command" to be a non-empty string when present.`,
        );
      }

      if (
        platformRecord.args !== undefined &&
        (!Array.isArray(platformRecord.args) || platformRecord.args.some((entry) => typeof entry !== "string"))
      ) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}.args" to be an array of strings when present.`,
        );
      }

      if (platformRecord.assetName === undefined && platformRecord.assetUrl === undefined) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}" to define "assetName" and/or "assetUrl".`,
        );
      }

      return [
        platform.trim(),
        {
          assetName: typeof platformRecord.assetName === "string" ? platformRecord.assetName.trim() : undefined,
          assetUrl: typeof platformRecord.assetUrl === "string" ? platformRecord.assetUrl.trim() : undefined,
          archiveType: archiveType as "zip" | "tar.gz" | "tgz",
          command: typeof platformRecord.command === "string" ? platformRecord.command.trim() : undefined,
          args: Array.isArray(platformRecord.args) ? platformRecord.args.map((entry) => entry.trim()) : undefined,
        },
      ];
    }),
  );

  return {
    kind: "archive",
    source: {
      type: "github-release",
      repo: expectNonEmptyString(sourceRecord.repo, "artifact.source.repo", manifestPath),
      channel: typeof sourceRecord.channel === "string" ? sourceRecord.channel.trim() : undefined,
      tag: typeof sourceRecord.tag === "string" ? sourceRecord.tag.trim() : undefined,
      serviceManifestAssetUrl:
        typeof sourceRecord.serviceManifestAssetUrl === "string" ? sourceRecord.serviceManifestAssetUrl.trim() : undefined,
      api_base_url:
        typeof sourceRecord.api_base_url === "string" ? sourceRecord.api_base_url.trim() : undefined,
    },
    platforms,
  };
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
    const readinessOptions = readHealthcheckReadinessOptions(healthRecord, manifestPath);
    if (healthRecord.type === "process") {
      healthcheck = { type: "process", ...readinessOptions };
    } else if (healthRecord.type === "http") {
      healthcheck = {
        type: "http",
        url: expectNonEmptyString(healthRecord.url, "healthcheck.url", manifestPath),
        expected_status:
          typeof healthRecord.expected_status === "number" ? healthRecord.expected_status : undefined,
        ...readinessOptions,
      };
    } else if (healthRecord.type === "tcp") {
      healthcheck = {
        type: "tcp",
        address: expectNonEmptyString(healthRecord.address, "healthcheck.address", manifestPath),
        ...readinessOptions,
      };
    } else if (healthRecord.type === "file") {
      healthcheck = {
        type: "file",
        file: expectNonEmptyString(healthRecord.file, "healthcheck.file", manifestPath),
        ...readinessOptions,
      };
    } else if (healthRecord.type === "variable") {
      healthcheck = {
        type: "variable",
        variable: expectNonEmptyString(healthRecord.variable, "healthcheck.variable", manifestPath),
        ...readinessOptions,
      };
    } else {
      throw new Error(`Invalid service manifest at ${manifestPath}: unsupported healthcheck type.`);
    }
  }

  const rawEnv = record.env;
  if (
    rawEnv !== undefined &&
    (!rawEnv || typeof rawEnv !== "object" || Array.isArray(rawEnv) || Object.values(rawEnv).some((value) => typeof value !== "string"))
  ) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected \"env\" to be a string map.`);
  }

  const rawGlobalEnv = record.globalenv;
  if (
    rawGlobalEnv !== undefined &&
    (!rawGlobalEnv ||
      typeof rawGlobalEnv !== "object" ||
      Array.isArray(rawGlobalEnv) ||
      Object.values(rawGlobalEnv).some((value) => typeof value !== "string"))
  ) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected \"globalenv\" to be a string map.`);
  }

  const rawPorts = record.ports;
  if (
    rawPorts !== undefined &&
    (!rawPorts ||
      typeof rawPorts !== "object" ||
      Array.isArray(rawPorts) ||
      Object.values(rawPorts).some(
        (value) => typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 65535,
      ))
  ) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected \"ports\" to be a map of integer port values between 0 and 65535.`);
  }

  const rawExecservice = record.execservice;
  if (rawExecservice !== undefined && (typeof rawExecservice !== "string" || rawExecservice.trim().length === 0)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected \"execservice\" to be a non-empty string.`);
  }

  const rawExecutable = record.executable;
  if (rawExecutable !== undefined && (typeof rawExecutable !== "string" || rawExecutable.trim().length === 0)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected \"executable\" to be a non-empty string.`);
  }

  const rawArgs = record.args;
  if (
    rawArgs !== undefined &&
    (!Array.isArray(rawArgs) || rawArgs.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected \"args\" to be an array of strings.`);
  }

  const rawUrls = record.urls;
  if (
    rawUrls !== undefined &&
    (!Array.isArray(rawUrls) ||
      rawUrls.some(
        (entry) =>
          !entry ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          typeof (entry as Record<string, unknown>).label !== "string" ||
          typeof (entry as Record<string, unknown>).url !== "string",
      ))
  ) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected \"urls\" to be an array of { label, url } objects.`);
  }

  const artifact = readArtifact(record.artifact, manifestPath);
  const install = readActionMaterialization(record.install, "install", manifestPath);
  const config = readActionMaterialization(record.config, "config", manifestPath);

  return {
    id: expectNonEmptyString(record.id, "id", manifestPath),
    name: expectNonEmptyString(record.name, "name", manifestPath),
    description: expectNonEmptyString(record.description, "description", manifestPath),
    version: typeof record.version === "string" ? record.version : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    autostart: typeof record.autostart === "boolean" ? record.autostart : undefined,
    depend_on: dependOn?.map((dependency) => dependency.trim()),
    healthcheck,
    env: rawEnv ? Object.fromEntries(Object.entries(rawEnv as Record<string, string>).map(([key, value]) => [key.trim(), value])) : undefined,
    globalenv: rawGlobalEnv
      ? Object.fromEntries(Object.entries(rawGlobalEnv as Record<string, string>).map(([key, value]) => [key.trim(), value]))
      : undefined,
    ports: rawPorts
      ? Object.fromEntries(Object.entries(rawPorts as Record<string, number>).map(([key, value]) => [key.trim(), value]))
      : undefined,
    urls: rawUrls?.map((entry) => ({
      label: (entry as Record<string, string>).label.trim(),
      url: (entry as Record<string, string>).url.trim(),
      kind: typeof (entry as Record<string, unknown>).kind === "string" ? ((entry as Record<string, string>).kind).trim() : undefined,
    })),
    artifact,
    install,
    config,
    execservice: typeof rawExecservice === "string" ? rawExecservice.trim() : undefined,
    executable: typeof rawExecutable === "string" ? rawExecutable.trim() : undefined,
    args: rawArgs?.map((entry) => entry.trim()),
  };
}
