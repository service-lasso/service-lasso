import type {
  ServiceHookFailurePolicy,
  ServiceHookStep,
  ServiceManifest,
  ServiceUpdateInstallWindow,
  ServiceUpdateMode,
  ServiceUpdateRunningServicePolicy,
  ServiceUpdateWindowDay,
} from "../../contracts/service.js";
import type { ServiceHealthcheck } from "../health/types.js";

const hookFailurePolicies = new Set(["block", "warn", "continue"]);
const hookPhases = new Set(["preRestart", "postRestart", "preUpgrade", "postUpgrade", "rollback", "onFailure"]);
const updateModes = new Set(["disabled", "notify", "download", "install"]);
const updateRunningServicePolicies = new Set(["skip", "require-stopped", "stop-start", "restart"]);
const updateWindowDays = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

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

function expectOptionalBoolean(value: unknown, field: string, manifestPath: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be a boolean when present.`);
  }

  return value;
}

function expectOptionalFailurePolicy(
  value: unknown,
  field: string,
  manifestPath: string,
): ServiceHookFailurePolicy | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !hookFailurePolicies.has(value)) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: expected "${field}" to be one of "block", "warn", or "continue".`,
    );
  }

  return value as ServiceHookFailurePolicy;
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

function readStringMap(value: unknown, field: string, manifestPath: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be a string map.`);
  }

  return Object.fromEntries(Object.entries(value as Record<string, string>).map(([key, entry]) => [key.trim(), entry]));
}

function readHookSteps(value: unknown, field: string, manifestPath: string): ServiceHookStep[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an array of hook step objects.`);
  }

  return value.map((entry, index) => {
    const stepField = `${field}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${stepField}" to be an object.`);
    }

    const record = entry as Record<string, unknown>;
    const args = record.args;
    if (args !== undefined && (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${stepField}.args" to be an array of strings when present.`);
    }

    return {
      name: expectNonEmptyString(record.name, `${stepField}.name`, manifestPath),
      command: expectNonEmptyString(record.command, `${stepField}.command`, manifestPath),
      args: Array.isArray(args) ? args.map((arg) => (arg as string).trim()) : undefined,
      cwd: typeof record.cwd === "string" ? record.cwd.trim() : undefined,
      timeoutSeconds: expectOptionalWholeNumber(record.timeoutSeconds, `${stepField}.timeoutSeconds`, manifestPath, 1),
      failurePolicy: expectOptionalFailurePolicy(record.failurePolicy, `${stepField}.failurePolicy`, manifestPath),
      env: readStringMap(record.env, `${stepField}.env`, manifestPath),
    };
  });
}

function readMonitoringPolicy(value: unknown, manifestPath: string): ServiceManifest["monitoring"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "monitoring" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  return {
    enabled: expectOptionalBoolean(record.enabled, "monitoring.enabled", manifestPath),
    intervalSeconds: expectOptionalWholeNumber(record.intervalSeconds, "monitoring.intervalSeconds", manifestPath, 1),
    unhealthyThreshold: expectOptionalWholeNumber(record.unhealthyThreshold, "monitoring.unhealthyThreshold", manifestPath, 1),
    startupGraceSeconds: expectOptionalWholeNumber(record.startupGraceSeconds, "monitoring.startupGraceSeconds", manifestPath, 0),
  };
}

function readRestartPolicy(value: unknown, manifestPath: string): ServiceManifest["restartPolicy"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "restartPolicy" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  return {
    enabled: expectOptionalBoolean(record.enabled, "restartPolicy.enabled", manifestPath),
    onCrash: expectOptionalBoolean(record.onCrash, "restartPolicy.onCrash", manifestPath),
    onUnhealthy: expectOptionalBoolean(record.onUnhealthy, "restartPolicy.onUnhealthy", manifestPath),
    maxAttempts: expectOptionalWholeNumber(record.maxAttempts, "restartPolicy.maxAttempts", manifestPath, 0),
    backoffSeconds: expectOptionalWholeNumber(record.backoffSeconds, "restartPolicy.backoffSeconds", manifestPath, 0),
  };
}

function readDoctorPolicy(value: unknown, manifestPath: string): ServiceManifest["doctor"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "doctor" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  return {
    enabled: expectOptionalBoolean(record.enabled, "doctor.enabled", manifestPath),
    timeoutSeconds: expectOptionalWholeNumber(record.timeoutSeconds, "doctor.timeoutSeconds", manifestPath, 1),
    failurePolicy: expectOptionalFailurePolicy(record.failurePolicy, "doctor.failurePolicy", manifestPath),
    steps: readHookSteps(record.steps, "doctor.steps", manifestPath),
  };
}

function readLifecycleHooks(value: unknown, manifestPath: string): ServiceManifest["hooks"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "hooks" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  const unsupported = Object.keys(record).find((key) => !hookPhases.has(key));
  if (unsupported) {
    throw new Error(`Invalid service manifest at ${manifestPath}: unsupported hooks phase "${unsupported}".`);
  }

  return {
    preRestart: readHookSteps(record.preRestart, "hooks.preRestart", manifestPath),
    postRestart: readHookSteps(record.postRestart, "hooks.postRestart", manifestPath),
    preUpgrade: readHookSteps(record.preUpgrade, "hooks.preUpgrade", manifestPath),
    postUpgrade: readHookSteps(record.postUpgrade, "hooks.postUpgrade", manifestPath),
    rollback: readHookSteps(record.rollback, "hooks.rollback", manifestPath),
    onFailure: readHookSteps(record.onFailure, "hooks.onFailure", manifestPath),
  };
}

function expectTimeOfDay(value: unknown, field: string, manifestPath: string): string {
  const candidate = expectNonEmptyString(value, field, manifestPath);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to use HH:mm 24-hour time.`);
  }

  return candidate;
}

function readUpdateInstallWindow(
  value: unknown,
  manifestPath: string,
): ServiceUpdateInstallWindow | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "updates.installWindow" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  const days = record.days;
  if (days !== undefined) {
    if (!Array.isArray(days) || days.some((day) => typeof day !== "string" || !updateWindowDays.has(day))) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: expected "updates.installWindow.days" to contain weekday values mon through sun.`,
      );
    }
  }

  return {
    days: Array.isArray(days) ? days.map((day) => day as ServiceUpdateWindowDay) : undefined,
    start: expectTimeOfDay(record.start, "updates.installWindow.start", manifestPath),
    end: expectTimeOfDay(record.end, "updates.installWindow.end", manifestPath),
    timezone: typeof record.timezone === "string" ? record.timezone.trim() : undefined,
  };
}

function readUpdatePolicy(
  value: unknown,
  artifact: ServiceManifest["artifact"],
  manifestPath: string,
): ServiceManifest["updates"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "updates" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  const enabled = expectOptionalBoolean(record.enabled, "updates.enabled", manifestPath);
  const rawMode = record.mode;
  if (rawMode !== undefined && (typeof rawMode !== "string" || !updateModes.has(rawMode))) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: expected "updates.mode" to be one of "disabled", "notify", "download", or "install".`,
    );
  }
  const mode = rawMode as ServiceUpdateMode | undefined;
  const rawTrack = record.track;
  const track =
    rawTrack === undefined ? undefined : expectNonEmptyString(rawTrack, "updates.track", manifestPath);
  const checkIntervalSeconds = expectOptionalWholeNumber(
    record.checkIntervalSeconds,
    "updates.checkIntervalSeconds",
    manifestPath,
    60,
  );
  const installWindow = readUpdateInstallWindow(record.installWindow, manifestPath);
  const rawRunningService = record.runningService;
  if (
    rawRunningService !== undefined &&
    (typeof rawRunningService !== "string" || !updateRunningServicePolicies.has(rawRunningService))
  ) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: expected "updates.runningService" to be one of "skip", "require-stopped", "stop-start", or "restart".`,
    );
  }
  const runningService = rawRunningService as ServiceUpdateRunningServicePolicy | undefined;

  if (enabled === false && mode !== undefined && mode !== "disabled") {
    throw new Error(`Invalid service manifest at ${manifestPath}: "updates.enabled" false can only use mode "disabled".`);
  }

  if (enabled === true && mode === "disabled") {
    throw new Error(`Invalid service manifest at ${manifestPath}: "updates.enabled" true cannot use mode "disabled".`);
  }

  if (mode === "disabled" && track !== undefined && track !== "pinned") {
    throw new Error(`Invalid service manifest at ${manifestPath}: disabled updates cannot track a moving release source.`);
  }

  if (mode !== "install" && installWindow !== undefined) {
    throw new Error(`Invalid service manifest at ${manifestPath}: "updates.installWindow" is only valid with mode "install".`);
  }

  if (mode !== "install" && runningService !== undefined) {
    throw new Error(`Invalid service manifest at ${manifestPath}: "updates.runningService" is only valid with mode "install".`);
  }

  const activeMode = mode === "notify" || mode === "download" || mode === "install";
  if (activeMode) {
    if (!artifact) {
      throw new Error(`Invalid service manifest at ${manifestPath}: active updates require manifest "artifact" metadata.`);
    }

    if (track === undefined || track === "pinned") {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: active updates require "updates.track" to be "latest" or a named channel/tag.`,
      );
    }
  }

  if (mode === "install" && (!installWindow || !runningService)) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: install-mode updates require both "updates.installWindow" and "updates.runningService".`,
    );
  }

  return {
    enabled,
    mode,
    track,
    checkIntervalSeconds,
    installWindow,
    runningService,
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
  const monitoring = readMonitoringPolicy(record.monitoring, manifestPath);
  const restartPolicy = readRestartPolicy(record.restartPolicy, manifestPath);
  const doctor = readDoctorPolicy(record.doctor, manifestPath);
  const hooks = readLifecycleHooks(record.hooks, manifestPath);
  const updates = readUpdatePolicy(record.updates, artifact, manifestPath);

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
    monitoring,
    restartPolicy,
    doctor,
    hooks,
    updates,
    artifact,
    install,
    config,
    execservice: typeof rawExecservice === "string" ? rawExecservice.trim() : undefined,
    executable: typeof rawExecutable === "string" ? rawExecutable.trim() : undefined,
    args: rawArgs?.map((entry) => entry.trim()),
  };
}
