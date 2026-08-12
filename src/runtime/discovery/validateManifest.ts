import path from "node:path";
import type {
  ServiceBrokerAccessOperation,
  ServiceBrokerAccessScope,
  ServiceBrokerBucketKind,
  ServiceBrokerChangeReactionMode,
  ServiceBrokerWritebackOperation,
  ServiceHookFailurePolicy,
  ServiceLogSourceDeclaration,
  ServiceLogSourceFormat,
  ServiceLogSourceType,
  ServiceHookStep,
  ServiceActionConcurrencyPolicy,
  ServiceActionFailurePolicy,
  ServiceActionMode,
  ServiceActionPayloadJsonType,
  ServiceActionPayloadSchema,
  ServiceActionRequiredState,
  ServiceEndpointDirection,
  ServiceEndpointExposure,
  ServiceEndpointKind,
  ServiceEndpointPortStrategy,
  ServiceEndpointProtocol,
  ServiceEndpointTransport,
  ServiceFilesRootMode,
  ServiceManifestEndpoint,
  ServiceActionWorkflowStep,
  ServiceEnvMap,
  ServiceEnvValue,
  ServiceManifest,
  ServiceSetupRerunPolicy,
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
const serviceRoles = new Set(["service", "provider"]);
const setupRerunPolicies = new Set(["manual", "ifMissing", "always"]);
const actionModes = new Set(["built-in", "command", "workflow", "handler"]);
const actionRequiredStates = new Set(["any", "running", "stopped"]);
const actionConcurrencyPolicies = new Set(["skip-if-running", "allow-parallel"]);
const actionFailurePolicies = new Set(["record", "retry", "disable-schedule"]);
const actionPayloadJsonTypes = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
const brokerAccessOperations = new Set(["resolve", "create", "update", "rotate", "delete"]);
const brokerAccessScopes = new Set(["workspace", "service", "app", "shared", "global"]);
const brokerWritebackOperations = new Set(["create", "update", "rotate", "delete"]);
const brokerBucketKinds = new Set(["service", "app", "shared", "global"]);
const brokerChangeReactionModes = new Set(["restart", "reload", "action", "manual", "none"]);
const endpointKinds = new Set(["network", "url", "mount", "device"]);
const endpointDirections = new Set(["inbound", "outbound"]);
const endpointTransports = new Set(["tcp", "udp"]);
const endpointProtocols = new Set(["http", "https", "tcp", "udp"]);
const endpointExposures = new Set(["local", "lan", "public"]);
const endpointPortStrategies = new Set(["automatic", "preferred", "fixed"]);
const filesRootModes = new Set<ServiceFilesRootMode>(["read-only", "read-write"]);
const logSourceTypes = new Set(["file", "glob"]);
const logSourceFormats = new Set(["text", "json", "ndjson"]);
const brokerNamespacePattern = /^[A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/;
const brokerRefPattern = /^[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const endpointIdPattern = /^[A-Za-z][A-Za-z0-9_:-]*$/;
const filesRootIdPattern = /^[A-Za-z][A-Za-z0-9_:-]*$/;
const logSourceIdPattern = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const serviceIdPattern = /^@?[A-Za-z0-9][A-Za-z0-9._-]*$/;
const windowsReservedServiceIdPattern = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

export function validateServiceId(value: unknown, manifestPath: string): string {
  const serviceId = expectNonEmptyString(value, "id", manifestPath);
  const filesystemName = serviceId.startsWith("@") ? serviceId.slice(1) : serviceId;
  if (
    serviceId.length > 128 ||
    !serviceIdPattern.test(serviceId) ||
    serviceId.endsWith(".") ||
    windowsReservedServiceIdPattern.test(filesystemName)
  ) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: expected "id" to be a portable direct-child service identifier.`,
    );
  }

  return serviceId;
}

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
  fieldPrefix = "healthcheck",
): Record<string, number> {
  const interval = expectOptionalWholeNumber(healthRecord.interval, `${fieldPrefix}.interval`, manifestPath, 1);
  const retries = expectOptionalWholeNumber(healthRecord.retries, `${fieldPrefix}.retries`, manifestPath, 1);
  const startPeriod = expectOptionalWholeNumber(
    healthRecord.start_period,
    `${fieldPrefix}.start_period`,
    manifestPath,
    0,
  );
  const timeout = expectOptionalWholeNumber(healthRecord.timeout, `${fieldPrefix}.timeout`, manifestPath, 1);

  return {
    ...(interval !== undefined ? { interval } : {}),
    ...(retries !== undefined ? { retries } : {}),
    ...(startPeriod !== undefined ? { start_period: startPeriod } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
}

function readHealthcheckRecord(
  rawHealthcheck: unknown,
  manifestPath: string,
  fieldPrefix = "healthcheck",
  options: { requireId?: boolean; defaultRequired?: boolean } = {},
): ServiceHealthcheck {
  if (!rawHealthcheck || typeof rawHealthcheck !== "object" || Array.isArray(rawHealthcheck)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${fieldPrefix}" to be an object.`);
  }

  const healthRecord = rawHealthcheck as Record<string, unknown>;
  const readinessOptions = readHealthcheckReadinessOptions(healthRecord, manifestPath, fieldPrefix);
  const id =
    options.requireId || healthRecord.id !== undefined
      ? expectNonEmptyString(healthRecord.id, `${fieldPrefix}.id`, manifestPath)
      : undefined;
  const required =
    options.defaultRequired || healthRecord.required !== undefined
      ? (expectOptionalBoolean(healthRecord.required, `${fieldPrefix}.required`, manifestPath) ?? true)
      : undefined;
  const sharedFields = {
    ...(id !== undefined ? { id } : {}),
    ...(required !== undefined ? { required } : {}),
    ...readinessOptions,
  };

  if (healthRecord.type === "process") {
    return { type: "process", ...sharedFields };
  }

  if (healthRecord.type === "http") {
    const cookies = readStringMap(healthRecord.cookies, `${fieldPrefix}.cookies`, manifestPath);
    return {
      type: "http",
      url: expectNonEmptyString(healthRecord.url, `${fieldPrefix}.url`, manifestPath),
      expected_status:
        typeof healthRecord.expected_status === "number" ? healthRecord.expected_status : undefined,
      ...(cookies !== undefined ? { cookies } : {}),
      ...sharedFields,
    };
  }

  if (healthRecord.type === "tcp") {
    if (healthRecord.tcphost !== undefined || healthRecord.tcpport !== undefined) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: "tcphost" and "tcpport" are not supported; use "${fieldPrefix}.host" + "${fieldPrefix}.port" or "${fieldPrefix}.address".`,
      );
    }

    const hasAddress = healthRecord.address !== undefined;
    const hasHost = healthRecord.host !== undefined;
    const hasPort = healthRecord.port !== undefined;
    const rawPort = healthRecord.port;

    if (hasAddress && (hasHost || hasPort)) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: TCP healthcheck must use either "${fieldPrefix}.address" or "${fieldPrefix}.host" + "${fieldPrefix}.port", not both.`,
      );
    }

    if (hasHost !== hasPort) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: TCP healthcheck "host" and "port" must be supplied together.`,
      );
    }

    if (
      hasPort &&
      typeof rawPort !== "string" &&
      (typeof rawPort !== "number" ||
        !Number.isInteger(rawPort) ||
        rawPort < 1 ||
        rawPort > 65535)
    ) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: expected "${fieldPrefix}.port" to be a non-empty string selector or an integer port between 1 and 65535.`,
      );
    }

    if (typeof rawPort === "string" && rawPort.trim().length === 0) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected non-empty string for "${fieldPrefix}.port".`);
    }

    const normalizedPort =
      rawPort === undefined
        ? undefined
        : typeof rawPort === "number"
          ? rawPort
          : typeof rawPort === "string"
            ? rawPort.trim()
            : undefined;

    return {
      type: "tcp",
      ...(hasAddress ? { address: expectNonEmptyString(healthRecord.address, `${fieldPrefix}.address`, manifestPath) } : {}),
      ...(hasHost ? { host: expectNonEmptyString(healthRecord.host, `${fieldPrefix}.host`, manifestPath) } : {}),
      ...(normalizedPort !== undefined ? { port: normalizedPort } : {}),
      ...sharedFields,
    };
  }

  if (healthRecord.type === "udp") {
    const hasAddress = healthRecord.address !== undefined;
    const hasHost = healthRecord.host !== undefined;
    const hasPort = healthRecord.port !== undefined;
    const rawPort = healthRecord.port;

    if (hasAddress && (hasHost || hasPort)) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: UDP healthcheck must use either "${fieldPrefix}.address" or "${fieldPrefix}.host" + "${fieldPrefix}.port", not both.`,
      );
    }

    if (hasHost !== hasPort) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: UDP healthcheck "host" and "port" must be supplied together.`,
      );
    }

    if (!hasAddress && !hasHost) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: UDP healthcheck must define either "${fieldPrefix}.address" or "${fieldPrefix}.host" + "${fieldPrefix}.port".`,
      );
    }

    if (
      hasPort &&
      typeof rawPort !== "string" &&
      (typeof rawPort !== "number" ||
        !Number.isInteger(rawPort) ||
        rawPort < 1 ||
        rawPort > 65535)
    ) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: expected "${fieldPrefix}.port" to be a non-empty string selector or an integer port between 1 and 65535.`,
      );
    }

    if (typeof rawPort === "string" && rawPort.trim().length === 0) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected non-empty string for "${fieldPrefix}.port".`);
    }

    const normalizedPort =
      rawPort === undefined
        ? undefined
        : typeof rawPort === "number"
          ? rawPort
          : typeof rawPort === "string"
            ? rawPort.trim()
            : undefined;

    return {
      type: "udp",
      ...(hasAddress ? { address: expectNonEmptyString(healthRecord.address, `${fieldPrefix}.address`, manifestPath) } : {}),
      ...(hasHost ? { host: expectNonEmptyString(healthRecord.host, `${fieldPrefix}.host`, manifestPath) } : {}),
      ...(normalizedPort !== undefined ? { port: normalizedPort } : {}),
      send: expectNonEmptyString(healthRecord.send, `${fieldPrefix}.send`, manifestPath),
      expect: expectNonEmptyString(healthRecord.expect, `${fieldPrefix}.expect`, manifestPath),
      ...sharedFields,
    };
  }

  if (healthRecord.type === "file") {
    return {
      type: "file",
      file: expectNonEmptyString(healthRecord.file, `${fieldPrefix}.file`, manifestPath),
      ...sharedFields,
    };
  }

  if (healthRecord.type === "variable") {
    return {
      type: "variable",
      variable: expectNonEmptyString(healthRecord.variable, `${fieldPrefix}.variable`, manifestPath),
      ...sharedFields,
    };
  }

  throw new Error(`Invalid service manifest at ${manifestPath}: unsupported healthcheck type.`);
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

  if (
    record.templates !== undefined &&
    (!Array.isArray(record.templates) ||
      record.templates.some(
        (entry) =>
          !entry ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          typeof (entry as Record<string, unknown>).source !== "string" ||
          typeof (entry as Record<string, unknown>).target !== "string",
      ))
  ) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: expected "${field}.templates" to be an array of { source, target } objects.`,
    );
  }

  if (!record.files && !record.templates) {
    return {};
  }

  return {
    ...(record.files
      ? {
          files: record.files.map((entry) => ({
            path: expectNonEmptyString((entry as Record<string, string>).path, `${field}.files.path`, manifestPath),
            content: (entry as Record<string, string>).content,
          })),
        }
      : {}),
    ...(record.templates
      ? {
          templates: record.templates.map((entry) => ({
            source: expectNonEmptyString(
              (entry as Record<string, string>).source,
              `${field}.templates.source`,
              manifestPath,
            ),
            target: expectNonEmptyString(
              (entry as Record<string, string>).target,
              `${field}.templates.target`,
              manifestPath,
            ),
          })),
        }
      : {}),
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

function isServiceEnvValue(value: unknown): value is ServiceEnvValue {
  if (typeof value === "string") {
    return true;
  }

  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function readEnvMap(value: unknown, field: string, manifestPath: string): ServiceEnvMap | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((entry) => !isServiceEnvValue(entry))) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: expected "${field}" to be a map of strings or non-empty string arrays.`,
    );
  }

  return Object.fromEntries(Object.entries(value as ServiceEnvMap).map(([key, entry]) => [key.trim(), entry]));
}

function readOutputVarRegex(value: unknown, manifestPath: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "outputvarregex" to be a string map.`);
  }

  const variables = new Map<string, string>();
  for (const [rawName, pattern] of Object.entries(value as Record<string, string>)) {
    const variableName = rawName.trim();
    if (variableName.length === 0) {
      throw new Error(`Invalid service manifest at ${manifestPath}: outputvarregex variable names must be non-empty.`);
    }
    if (variables.has(variableName)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: duplicate outputvarregex variable "${variableName}".`);
    }
    try {
      new RegExp(pattern);
    } catch {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected outputvarregex.${variableName} to be a valid regular expression.`);
    }
    variables.set(variableName, pattern);
  }

  return Object.fromEntries(variables);
}

function readNonEmptyStringArray(value: unknown, field: string, manifestPath: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an array of non-empty strings.`);
  }

  return value.map((entry) => (entry as string).trim());
}

function expectSafeRelativeLogPath(value: unknown, field: string, manifestPath: string): string {
  const candidate = expectNonEmptyString(value, field, manifestPath).replace(/\\/g, "/");
  const segments = candidate.split("/");
  if (
    candidate.startsWith("/") ||
    /^[A-Za-z]:/.test(candidate) ||
    segments.some((segment) => segment === "..")
  ) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to stay inside the service root.`);
  }

  return candidate;
}

function readLogSources(value: unknown, manifestPath: string): ServiceLogSourceDeclaration[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "logSources" to be an array.`);
  }

  const ids = new Set<string>();
  return value.map((entry, index) => {
    const field = `logSources[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
    }

    const record = entry as Record<string, unknown>;
    const id = expectNonEmptyString(record.id, `${field}.id`, manifestPath);
    if (!logSourceIdPattern.test(id) || id === "default" || id === "stdout" || id === "stderr") {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: expected "${field}.id" to be a unique non-builtin log source id.`,
      );
    }
    if (ids.has(id)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: duplicate logSources id "${id}".`);
    }
    ids.add(id);

    const rawType = expectNonEmptyString(record.type, `${field}.type`, manifestPath);
    if (!logSourceTypes.has(rawType)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.type" to be one of "file" or "glob".`);
    }

    const type = rawType as ServiceLogSourceType;
    const pathValue = record.path === undefined ? undefined : expectSafeRelativeLogPath(record.path, `${field}.path`, manifestPath);
    const pattern = record.pattern === undefined ? undefined : expectSafeRelativeLogPath(record.pattern, `${field}.pattern`, manifestPath);
    if (type === "file" && !pathValue) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.path" for file log sources.`);
    }
    if (type === "glob" && !pattern) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.pattern" for glob log sources.`);
    }

    const rawFormat = record.format;
    if (rawFormat !== undefined && (typeof rawFormat !== "string" || !logSourceFormats.has(rawFormat))) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.format" to be one of "text", "json", or "ndjson".`);
    }

    return {
      id,
      label: expectNonEmptyString(record.label, `${field}.label`, manifestPath),
      type,
      path: pathValue,
      pattern,
      format: rawFormat as ServiceLogSourceFormat | undefined,
    };
  });
}

function expectBrokerNamespace(value: unknown, field: string, manifestPath: string): string {
  const namespace = expectNonEmptyString(value, field, manifestPath);
  if (!brokerNamespacePattern.test(namespace)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be a valid broker namespace.`);
  }
  return namespace;
}

function expectBrokerRef(value: unknown, field: string, manifestPath: string): string {
  const ref = expectNonEmptyString(value, field, manifestPath);
  if (!brokerRefPattern.test(ref)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be a dotted broker ref like "namespace.KEY".`);
  }
  return ref;
}

function parseBrokerChangeReaction(value: unknown, field: string, manifestPath: string) {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  const mode = expectOptionalEnum<ServiceBrokerChangeReactionMode>(
    record.mode,
    `${field}.mode`,
    brokerChangeReactionModes,
    "restart, reload, action, manual, or none",
    manifestPath,
  );
  if (!mode) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.mode" to be set.`);
  }

  return {
    mode,
    actionId: record.actionId === undefined ? undefined : expectNonEmptyString(record.actionId, `${field}.actionId`, manifestPath),
    reason: record.reason === undefined ? undefined : expectNonEmptyString(record.reason, `${field}.reason`, manifestPath),
  };
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
      env: readEnvMap(record.env, `${stepField}.env`, manifestPath),
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

function readSetupPolicy(value: unknown, manifestPath: string): ServiceManifest["setup"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "setup" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  if (record.steps === undefined) {
    return {};
  }

  if (!record.steps || typeof record.steps !== "object" || Array.isArray(record.steps)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "setup.steps" to be an object.`);
  }

  const steps = Object.fromEntries(
    Object.entries(record.steps as Record<string, unknown>).map(([stepId, candidate]) => {
      const normalizedStepId = stepId.trim();
      if (normalizedStepId.length === 0) {
        throw new Error(`Invalid service manifest at ${manifestPath}: setup step ids must be non-empty.`);
      }

      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error(`Invalid service manifest at ${manifestPath}: expected "setup.steps.${normalizedStepId}" to be an object.`);
      }

      const step = candidate as Record<string, unknown>;
      const dependOn = step.depend_on;
      if (
        dependOn !== undefined &&
        (!Array.isArray(dependOn) ||
          dependOn.some((dependency) => typeof dependency !== "string" || dependency.trim().length === 0))
      ) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "setup.steps.${normalizedStepId}.depend_on" to be an array of non-empty strings.`,
        );
      }

      const args = step.args;
      if (args !== undefined && (!Array.isArray(args) || args.some((entry) => typeof entry !== "string"))) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "setup.steps.${normalizedStepId}.args" to be an array of strings.`,
        );
      }

      const outputs = step.outputs;
      if (outputs !== undefined && (!Array.isArray(outputs) || outputs.length === 0 || outputs.length > 32)) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "setup.steps.${normalizedStepId}.outputs" to be a non-empty array with at most 32 service-root-relative paths.`,
        );
      }

      const execservice = step.execservice;
      if (execservice !== undefined && (typeof execservice !== "string" || execservice.trim().length === 0)) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "setup.steps.${normalizedStepId}.execservice" to be a non-empty string.`,
        );
      }

      const cwd = step.cwd;
      if (cwd !== undefined && (typeof cwd !== "string" || cwd.trim().length === 0)) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "setup.steps.${normalizedStepId}.cwd" to be a non-empty string when present.`,
        );
      }

      const rawRerun = step.rerun;
      if (rawRerun !== undefined && (typeof rawRerun !== "string" || !setupRerunPolicies.has(rawRerun))) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "setup.steps.${normalizedStepId}.rerun" to be one of "manual", "ifMissing", or "always".`,
        );
      }

      return [
        normalizedStepId,
        {
          description: typeof step.description === "string" ? step.description.trim() : undefined,
          depend_on: Array.isArray(dependOn) ? dependOn.map((dependency) => (dependency as string).trim()) : undefined,
          execservice: typeof execservice === "string" ? execservice.trim() : undefined,
          executable: typeof step.executable === "string" ? step.executable.trim() : undefined,
          args: Array.isArray(args) ? args.map((entry) => entry.trim()) : undefined,
          commandline: readStringMap(step.commandline, `setup.steps.${normalizedStepId}.commandline`, manifestPath),
          cwd: typeof cwd === "string" ? cwd.trim() : undefined,
          env: readEnvMap(step.env, `setup.steps.${normalizedStepId}.env`, manifestPath),
          timeoutSeconds: expectOptionalWholeNumber(
            step.timeoutSeconds,
            `setup.steps.${normalizedStepId}.timeoutSeconds`,
            manifestPath,
            1,
          ),
          rerun: rawRerun as ServiceSetupRerunPolicy | undefined,
          ...(Array.isArray(outputs)
            ? {
                outputs: outputs.map((output, index) => {
                  if (typeof output !== "string") {
                    throw new Error(`Invalid service manifest at ${manifestPath}: expected "setup.steps.${normalizedStepId}.outputs.${index}" to be a string.`);
                  }
                  return assertServiceRootRelativePath(
                    output,
                    `setup.steps.${normalizedStepId}.outputs.${index}`,
                    manifestPath,
                  );
                }),
              }
            : {}),
        },
      ];
    }),
  );

  return { steps };
}

function assertServiceRootRelativePath(value: string, field: string, manifestPath: string): string {
  const declaredPath = value.trim();
  if (declaredPath.length === 0) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be a non-empty service-root-relative path.`);
  }

  if (path.isAbsolute(declaredPath)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be relative to the service root.`);
  }

  if (declaredPath.split(/[\\/]+/).includes("..")) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to stay inside the service root.`);
  }

  return declaredPath;
}

function readFilesPolicy(value: unknown, manifestPath: string): ServiceManifest["files"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "files" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  const enabled = expectOptionalBoolean(record.enabled, "files.enabled", manifestPath);
  if (record.roots === undefined) {
    return { enabled };
  }

  if (!Array.isArray(record.roots)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "files.roots" to be an array.`);
  }

  const seenRootIds = new Set<string>();
  const roots = record.roots.map((entry, index) => {
    const field = `files.roots[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
    }

    const root = entry as Record<string, unknown>;
    const id = expectNonEmptyString(root.id, `${field}.id`, manifestPath);
    if (!filesRootIdPattern.test(id)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.id" to be a stable root id.`);
    }
    if (seenRootIds.has(id)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: duplicate files root id "${id}".`);
    }
    seenRootIds.add(id);

    const mode = expectOptionalEnum<ServiceFilesRootMode>(
      root.mode,
      `${field}.mode`,
      filesRootModes,
      '"read-only" or "read-write"',
      manifestPath,
    ) ?? "read-only";

    return {
      id,
      label: expectNonEmptyString(root.label, `${field}.label`, manifestPath),
      path: assertServiceRootRelativePath(expectNonEmptyString(root.path, `${field}.path`, manifestPath), `${field}.path`, manifestPath),
      mode,
      hidden: expectOptionalBoolean(root.hidden, `${field}.hidden`, manifestPath),
      protected: expectOptionalBoolean(root.protected, `${field}.protected`, manifestPath),
    };
  });

  return { enabled, roots };
}

function readStringArray(value: unknown, field: string, manifestPath: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an array of non-empty strings.`);
  }

  return value.map((entry) => entry.trim());
}

function readExecutionConfig(value: unknown, manifestPath: string): ServiceManifest["execconfig"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "execconfig" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  const serviceorder = expectOptionalWholeNumber(record.serviceorder, "execconfig.serviceorder", manifestPath, 0);

  return serviceorder === undefined ? {} : { serviceorder };
}

function readJsonObject(value: unknown, field: string, manifestPath: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
  }

  return value as Record<string, unknown>;
}

function readEndpointPortDeclaration(
  value: unknown,
  field: string,
  manifestPath: string,
): ServiceManifestEndpoint["port"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  const defaultPort = expectOptionalWholeNumber(record.default, `${field}.default`, manifestPath, 0);
  if (defaultPort !== undefined && defaultPort > 65535) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.default" to be between 0 and 65535.`);
  }

  const strategy = expectOptionalEnum<ServiceEndpointPortStrategy>(
    record.strategy,
    `${field}.strategy`,
    endpointPortStrategies,
    [...endpointPortStrategies].map((entry) => `"${entry}"`).join(", "),
    manifestPath,
  );
  const policy = expectOptionalEnum<ServiceEndpointPortStrategy>(
    record.policy,
    `${field}.policy`,
    endpointPortStrategies,
    [...endpointPortStrategies].map((entry) => `"${entry}"`).join(", "),
    manifestPath,
  );

  let range: { start: number; end: number } | undefined;
  if (record.range !== undefined) {
    if (!record.range || typeof record.range !== "object" || Array.isArray(record.range)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.range" to be an object.`);
    }
    const rangeRecord = record.range as Record<string, unknown>;
    const start = expectOptionalWholeNumber(rangeRecord.start, `${field}.range.start`, manifestPath, 1);
    const end = expectOptionalWholeNumber(rangeRecord.end, `${field}.range.end`, manifestPath, 1);
    if (start === undefined || end === undefined || end < start || end > 65535) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.range" to define a valid port range.`);
    }
    range = { start, end };
  }

  return {
    ...(defaultPort !== undefined ? { default: defaultPort } : {}),
    ...(strategy !== undefined ? { strategy } : {}),
    ...(policy !== undefined ? { policy } : {}),
    ...(range !== undefined ? { range } : {}),
  };
}

function readManifestEndpoints(value: unknown, manifestPath: string): ServiceManifestEndpoint[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "endpoints" to be an array.`);
  }

  const seen = new Set<string>();
  return value.map((entry, index) => {
    const field = `endpoints[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
    }

    const record = entry as Record<string, unknown>;
    for (const unsupported of ["env", "globalenv", "export", "exports"]) {
      if (record[unsupported] !== undefined) {
        throw new Error(`Invalid service manifest at ${manifestPath}: endpoint entries must not contain "${unsupported}" blocks.`);
      }
    }

    const id = expectNonEmptyString(record.id, `${field}.id`, manifestPath);
    if (!endpointIdPattern.test(id)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.id" to be a selector-safe endpoint id.`);
    }
    if (seen.has(id)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: duplicate endpoint id "${id}".`);
    }
    seen.add(id);

    const kind = expectOptionalEnum<ServiceEndpointKind>(
      record.kind,
      `${field}.kind`,
      endpointKinds,
      [...endpointKinds].map((entry) => `"${entry}"`).join(", "),
      manifestPath,
    );
    if (!kind) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.kind" to be present.`);
    }

    const url = record.url === undefined ? undefined : expectNonEmptyString(record.url, `${field}.url`, manifestPath);
    const target = record.target === undefined ? undefined : expectNonEmptyString(record.target, `${field}.target`, manifestPath);

    if (kind === "network" && record.port === undefined) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.port" for network endpoints.`);
    }
    if (kind === "url" && !url && !target) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.url" or "${field}.target" for url endpoints.`);
    }

    return {
      id,
      kind,
      label: typeof record.label === "string" ? record.label.trim() : undefined,
      direction: expectOptionalEnum<ServiceEndpointDirection>(
        record.direction,
        `${field}.direction`,
        endpointDirections,
        [...endpointDirections].map((entry) => `"${entry}"`).join(", "),
        manifestPath,
      ),
      transport: expectOptionalEnum<ServiceEndpointTransport>(
        record.transport,
        `${field}.transport`,
        endpointTransports,
        [...endpointTransports].map((entry) => `"${entry}"`).join(", "),
        manifestPath,
      ),
      protocol: expectOptionalEnum<ServiceEndpointProtocol>(
        record.protocol,
        `${field}.protocol`,
        endpointProtocols,
        [...endpointProtocols].map((entry) => `"${entry}"`).join(", "),
        manifestPath,
      ),
      bind: typeof record.bind === "string" ? record.bind.trim() : undefined,
      port: readEndpointPortDeclaration(record.port, `${field}.port`, manifestPath),
      target,
      url,
      exposure: expectOptionalEnum<ServiceEndpointExposure>(
        record.exposure,
        `${field}.exposure`,
        endpointExposures,
        [...endpointExposures].map((entry) => `"${entry}"`).join(", "),
        manifestPath,
      ),
      required: expectOptionalBoolean(record.required, `${field}.required`, manifestPath),
      primary: expectOptionalBoolean(record.primary, `${field}.primary`, manifestPath),
    };
  });
}

function readActionPayloadSchema(
  value: unknown,
  field: string,
  manifestPath: string,
): ServiceActionPayloadSchema | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  const rawType = record.type;
  let type: ServiceActionPayloadJsonType | ServiceActionPayloadJsonType[] | undefined;

  if (rawType !== undefined) {
    const values = Array.isArray(rawType) ? rawType : [rawType];
    if (values.some((entry) => typeof entry !== "string" || !actionPayloadJsonTypes.has(entry))) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: expected "${field}.type" to use JSON schema primitive type names.`,
      );
    }
    type = Array.isArray(rawType)
      ? values.map((entry) => entry as ServiceActionPayloadJsonType)
      : (rawType as ServiceActionPayloadJsonType);
  }

  const required = readStringArray(record.required, `${field}.required`, manifestPath);
  const rawProperties = record.properties;
  let properties: Record<string, ServiceActionPayloadSchema> | undefined;

  if (rawProperties !== undefined) {
    if (!rawProperties || typeof rawProperties !== "object" || Array.isArray(rawProperties)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.properties" to be an object.`);
    }

    properties = Object.fromEntries(
      Object.entries(rawProperties as Record<string, unknown>).map(([propertyName, propertySchema]) => {
        const normalizedProperty = propertyName.trim();
        const parsedSchema = readActionPayloadSchema(propertySchema, `${field}.properties.${normalizedProperty}`, manifestPath);
        if (!parsedSchema) {
          throw new Error(
            `Invalid service manifest at ${manifestPath}: expected "${field}.properties.${normalizedProperty}" to be an object.`,
          );
        }
        return [normalizedProperty, parsedSchema];
      }),
    );
  }

  return {
    type,
    required,
    properties,
    additionalProperties: expectOptionalBoolean(record.additionalProperties, `${field}.additionalProperties`, manifestPath),
  };
}

function readActionPayloadPolicy(
  value: unknown,
  actionField: string,
  manifestPath: string,
): NonNullable<ServiceManifest["actions"]>[string]["payload"] {
  if (value === undefined) {
    return undefined;
  }

  const field = `${actionField}.payload`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  return {
    inline: expectOptionalBoolean(record.inline, `${field}.inline`, manifestPath),
    references: expectOptionalBoolean(record.references, `${field}.references`, manifestPath),
    allowMixed: expectOptionalBoolean(record.allowMixed, `${field}.allowMixed`, manifestPath),
    required: expectOptionalBoolean(record.required, `${field}.required`, manifestPath),
    schema: readActionPayloadSchema(record.schema, `${field}.schema`, manifestPath),
    recordInlineFields: readStringArray(record.recordInlineFields, `${field}.recordInlineFields`, manifestPath),
  };
}

function expectOptionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: Set<string>,
  allowedLabel: string,
  manifestPath: string,
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be one of ${allowedLabel}.`);
  }

  return value as T;
}

function validateCronExpression(value: unknown, field: string, manifestPath: string): string {
  const cron = expectNonEmptyString(value, field, manifestPath);
  const parts = cron.split(/\s+/);

  if (parts.length !== 5 && parts.length !== 6) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: expected "${field}" to be a 5- or 6-field cron expression.`,
    );
  }

  if (parts.some((part) => part.length === 0)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to contain populated cron fields.`);
  }

  return cron;
}

function readActionSchedules(
  value: unknown,
  actionField: string,
  manifestPath: string,
): NonNullable<ServiceManifest["actions"]>[string]["schedules"] {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${actionField}.schedules" to be an object.`);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([scheduleId, candidate]) => {
      const normalizedScheduleId = scheduleId.trim();
      const scheduleField = `${actionField}.schedules.${normalizedScheduleId}`;

      if (normalizedScheduleId.length === 0) {
        throw new Error(`Invalid service manifest at ${manifestPath}: action schedule ids must be non-empty.`);
      }

      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error(`Invalid service manifest at ${manifestPath}: expected "${scheduleField}" to be an object.`);
      }

      const schedule = candidate as Record<string, unknown>;
      if (schedule.action !== undefined || schedule.actionId !== undefined) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: "${scheduleField}" must not declare action references; schedules stay attached under their action.`,
        );
      }

      return [
        normalizedScheduleId,
        {
          label: typeof schedule.label === "string" ? schedule.label.trim() : undefined,
          enabled: expectOptionalBoolean(schedule.enabled, `${scheduleField}.enabled`, manifestPath),
          cron: validateCronExpression(schedule.cron, `${scheduleField}.cron`, manifestPath),
          timezone: typeof schedule.timezone === "string" ? schedule.timezone.trim() : undefined,
          concurrencyPolicy: expectOptionalEnum<ServiceActionConcurrencyPolicy>(
            schedule.concurrencyPolicy,
            `${scheduleField}.concurrencyPolicy`,
            actionConcurrencyPolicies,
            '"skip-if-running" or "allow-parallel"',
            manifestPath,
          ),
          failurePolicy: expectOptionalEnum<ServiceActionFailurePolicy>(
            schedule.failurePolicy,
            `${scheduleField}.failurePolicy`,
            actionFailurePolicies,
            '"record", "retry", or "disable-schedule"',
            manifestPath,
          ),
          parameters: readJsonObject(schedule.parameters, `${scheduleField}.parameters`, manifestPath),
        },
      ];
    }),
  );
}

function readActionWorkflowSteps(
  value: unknown,
  actionField: string,
  manifestPath: string,
): ServiceActionWorkflowStep[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${actionField}.steps" to be an array.`);
  }

  return value.map((candidate, index) => {
    const stepField = `${actionField}.steps[${index}]`;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "${stepField}" to be an object.`);
    }

    const step = candidate as Record<string, unknown>;
    const type = step.type;
    if (type !== undefined && type !== "service-lasso-action") {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: expected "${stepField}.type" to be "service-lasso-action" when present.`,
      );
    }

    const run = step.run;
    if (run !== undefined && run !== "always" && run !== "on-success") {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: expected "${stepField}.run" to be "always" or "on-success" when present.`,
      );
    }

    return {
      id: expectNonEmptyString(step.id, `${stepField}.id`, manifestPath),
      type: "service-lasso-action",
      actionId: expectNonEmptyString(step.actionId, `${stepField}.actionId`, manifestPath),
      run: run as ServiceActionWorkflowStep["run"],
      condition: typeof step.condition === "string" ? step.condition.trim() : undefined,
      parameters: readJsonObject(step.parameters, `${stepField}.parameters`, manifestPath),
    };
  });
}

function readActionPolicy(value: unknown, manifestPath: string): ServiceManifest["actions"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "actions" to be an object.`);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([actionId, candidate]) => {
      const normalizedActionId = actionId.trim();
      const actionField = `actions.${normalizedActionId}`;

      if (normalizedActionId.length === 0) {
        throw new Error(`Invalid service manifest at ${manifestPath}: action ids must be non-empty.`);
      }

      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error(`Invalid service manifest at ${manifestPath}: expected "${actionField}" to be an object.`);
      }

      const action = candidate as Record<string, unknown>;
      const commandline = readStringMap(action.commandline, `${actionField}.commandline`, manifestPath);
      const command = typeof action.command === "string" ? action.command.trim() : undefined;
      if (action.command !== undefined && (!command || command.length === 0)) {
        throw new Error(`Invalid service manifest at ${manifestPath}: expected "${actionField}.command" to be a non-empty string.`);
      }

      if (action.mode === "command" && command === undefined && commandline === undefined) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: command-backed action "${normalizedActionId}" requires "command" or "commandline".`,
        );
      }

      return [
        normalizedActionId,
        {
          label: typeof action.label === "string" ? action.label.trim() : undefined,
          description: typeof action.description === "string" ? action.description.trim() : undefined,
          mode: expectOptionalEnum<ServiceActionMode>(
            action.mode,
            `${actionField}.mode`,
            actionModes,
            '"built-in", "command", "workflow", or "handler"',
            manifestPath,
          ),
          command,
          commandline,
          args: readStringArray(action.args, `${actionField}.args`, manifestPath),
          cwd: typeof action.cwd === "string" ? action.cwd.trim() : undefined,
          env: readEnvMap(action.env, `${actionField}.env`, manifestPath),
          timeoutSeconds: expectOptionalWholeNumber(action.timeoutSeconds, `${actionField}.timeoutSeconds`, manifestPath, 1),
          requiredState: expectOptionalEnum<ServiceActionRequiredState>(
            action.requiredState,
            `${actionField}.requiredState`,
            actionRequiredStates,
            '"any", "running", or "stopped"',
            manifestPath,
          ),
          requiresConfirmation: expectOptionalBoolean(action.requiresConfirmation, `${actionField}.requiresConfirmation`, manifestPath),
          manualOnly: expectOptionalBoolean(action.manualOnly, `${actionField}.manualOnly`, manifestPath),
          permissions: readStringArray(action.permissions, `${actionField}.permissions`, manifestPath),
          steps: readActionWorkflowSteps(action.steps, actionField, manifestPath),
          payload: readActionPayloadPolicy(action.payload, actionField, manifestPath),
          schedules: readActionSchedules(action.schedules, actionField, manifestPath),
        },
      ];
    }),
  );
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

function validateUniqueEntries(values: string[], field: string, manifestPath: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: duplicate ${field} entry "${value}".`);
    }
    seen.add(value);
  }
}

function readBrokerPolicy(value: unknown, manifestPath: string, serviceId: string): ServiceManifest["broker"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "broker" to be an object.`);
  }

  const record = value as Record<string, unknown>;
  const buckets = record.buckets;
  if (buckets !== undefined && !Array.isArray(buckets)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "broker.buckets" to be an array.`);
  }
  const imports = record.imports;
  if (imports !== undefined && !Array.isArray(imports)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "broker.imports" to be an array.`);
  }
  const exports = record.exports;
  if (exports !== undefined && !Array.isArray(exports)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "broker.exports" to be an array.`);
  }

  const accessPolicy = record.accessPolicy;
  if (accessPolicy !== undefined && (!accessPolicy || typeof accessPolicy !== "object" || Array.isArray(accessPolicy))) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "broker.accessPolicy" to be an object.`);
  }
  const accessPolicyRecord = accessPolicy as Record<string, unknown> | undefined;
  const accessPolicyServiceId =
    accessPolicyRecord?.serviceId === undefined
      ? undefined
      : expectNonEmptyString(accessPolicyRecord.serviceId, "broker.accessPolicy.serviceId", manifestPath);
  if (accessPolicyServiceId !== undefined && accessPolicyServiceId !== serviceId) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: broker.accessPolicy.serviceId must match manifest id "${serviceId}".`,
    );
  }
  const accessPolicyWorkspace =
    accessPolicyRecord?.workspace === undefined
      ? undefined
      : expectNonEmptyString(accessPolicyRecord.workspace, "broker.accessPolicy.workspace", manifestPath);
  const accessPolicyGrants = accessPolicyRecord?.grants;
  if (accessPolicyGrants !== undefined && !Array.isArray(accessPolicyGrants)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "broker.accessPolicy.grants" to be an array.`);
  }
  const parsedAccessPolicyGrants = Array.isArray(accessPolicyGrants)
    ? accessPolicyGrants.map((entry, index) => {
        const field = `broker.accessPolicy.grants[${index}]`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
        }
        const grantRecord = entry as Record<string, unknown>;
        const rawScope = grantRecord.scope;
        if (rawScope !== undefined && (typeof rawScope !== "string" || !brokerAccessScopes.has(rawScope))) {
          throw new Error(
            `Invalid service manifest at ${manifestPath}: expected "${field}.scope" to be one of workspace, service, app, shared, or global.`,
          );
        }
        const operations = readNonEmptyStringArray(grantRecord.operations, `${field}.operations`, manifestPath);
        if (!operations || operations.length === 0 || operations.some((operation) => !brokerAccessOperations.has(operation))) {
          throw new Error(
            `Invalid service manifest at ${manifestPath}: expected "${field}.operations" to contain resolve, create, update, rotate, or delete.`,
          );
        }
        validateUniqueEntries(operations, `${field}.operations`, manifestPath);
        const refs = readNonEmptyStringArray(grantRecord.refs, `${field}.refs`, manifestPath);
        refs?.forEach((ref) => expectBrokerRef(ref, `${field}.refs`, manifestPath));
        validateUniqueEntries(refs ?? [], `${field}.refs`, manifestPath);
        return {
          namespace: expectBrokerNamespace(grantRecord.namespace, `${field}.namespace`, manifestPath),
          ...(rawScope === undefined ? {} : { scope: rawScope as ServiceBrokerAccessScope }),
          refs,
          operations: operations as ServiceBrokerAccessOperation[],
          purpose: expectNonEmptyString(grantRecord.purpose, `${field}.purpose`, manifestPath),
        };
      })
    : undefined;
  validateUniqueEntries(
    (parsedAccessPolicyGrants ?? []).map((grant) => `${grant.namespace}:${grant.scope ?? ""}:${(grant.refs ?? ["*"]).join(",")}:${grant.operations.join(",")}`),
    "broker.accessPolicy.grants",
    manifestPath,
  );

  const writeback = record.writeback;
  if (writeback !== undefined && (!writeback || typeof writeback !== "object" || Array.isArray(writeback))) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "broker.writeback" to be an object.`);
  }
  const writebackRecord = writeback as Record<string, unknown> | undefined;
  const allowedOperations = readNonEmptyStringArray(
    writebackRecord?.allowedOperations,
    "broker.writeback.allowedOperations",
    manifestPath,
  );
  if (allowedOperations?.some((operation) => !brokerWritebackOperations.has(operation))) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: expected "broker.writeback.allowedOperations" to contain create, update, rotate, or delete.`,
    );
  }
  const allowedNamespaces = readNonEmptyStringArray(
    writebackRecord?.allowedNamespaces,
    "broker.writeback.allowedNamespaces",
    manifestPath,
  );
  allowedNamespaces?.forEach((namespace) => expectBrokerNamespace(namespace, "broker.writeback.allowedNamespaces", manifestPath));
  const allowedRefs = readNonEmptyStringArray(writebackRecord?.allowedRefs, "broker.writeback.allowedRefs", manifestPath);
  allowedRefs?.forEach((ref) => expectBrokerRef(ref, "broker.writeback.allowedRefs", manifestPath));
  validateUniqueEntries(allowedRefs ?? [], "broker.writeback.allowedRefs", manifestPath);
  const allowOverwrite = expectOptionalBoolean(writebackRecord?.allowOverwrite, "broker.writeback.allowOverwrite", manifestPath);
  const auditReason =
    writebackRecord?.auditReason === undefined
      ? undefined
      : expectNonEmptyString(writebackRecord.auditReason, "broker.writeback.auditReason", manifestPath);
  const generatedSecrets = writebackRecord?.generatedSecrets;
  if (generatedSecrets !== undefined && !Array.isArray(generatedSecrets)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "broker.writeback.generatedSecrets" to be an array.`);
  }
  const parsedGeneratedSecrets = Array.isArray(generatedSecrets)
    ? generatedSecrets.map((entry, index) => {
        const field = `broker.writeback.generatedSecrets[${index}]`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
        }
        const captureRecord = entry as Record<string, unknown>;
        const operation = captureRecord.operation;
        if (operation !== undefined && (typeof operation !== "string" || !brokerWritebackOperations.has(operation))) {
          throw new Error(
            `Invalid service manifest at ${manifestPath}: expected "${field}.operation" to contain create, update, rotate, or delete.`,
          );
        }
        return {
          ref: expectBrokerRef(captureRecord.ref, `${field}.ref`, manifestPath),
          source: expectNonEmptyString(captureRecord.source, `${field}.source`, manifestPath),
          ...(operation === undefined ? {} : { operation: operation as ServiceBrokerWritebackOperation }),
          required: expectOptionalBoolean(captureRecord.required, `${field}.required`, manifestPath),
        };
      })
    : undefined;
  validateUniqueEntries(parsedGeneratedSecrets?.map((entry) => entry.ref) ?? [], "broker.writeback.generatedSecrets.ref", manifestPath);

  const parsedBuckets = Array.isArray(buckets)
    ? buckets.map((entry, index) => {
        const field = `broker.buckets[${index}]`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
        }
        const bucketRecord = entry as Record<string, unknown>;
        const kind = bucketRecord.kind;
        if (kind !== undefined && (typeof kind !== "string" || !brokerBucketKinds.has(kind))) {
          throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}.kind" to be one of service, app, shared, or global.`);
        }
        return {
          namespace: expectBrokerNamespace(bucketRecord.namespace, `${field}.namespace`, manifestPath),
          ...(kind === undefined ? {} : { kind: kind as ServiceBrokerBucketKind }),
          ...(bucketRecord.description === undefined
            ? {}
            : { description: expectNonEmptyString(bucketRecord.description, `${field}.description`, manifestPath) }),
        };
      })
    : undefined;
  validateUniqueEntries(parsedBuckets?.map((entry) => entry.namespace) ?? [], "broker.buckets.namespace", manifestPath);

  return {
    enabled: expectOptionalBoolean(record.enabled, "broker.enabled", manifestPath),
    namespace: record.namespace === undefined ? undefined : expectBrokerNamespace(record.namespace, "broker.namespace", manifestPath),
    buckets: parsedBuckets,
    imports: Array.isArray(imports)
      ? imports.map((entry, index) => {
          const field = `broker.imports[${index}]`;
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
          }
          const importRecord = entry as Record<string, unknown>;
          return {
            namespace: expectBrokerNamespace(importRecord.namespace, `${field}.namespace`, manifestPath),
            ref: expectBrokerRef(importRecord.ref, `${field}.ref`, manifestPath),
            as: importRecord.as === undefined ? undefined : expectNonEmptyString(importRecord.as, `${field}.as`, manifestPath),
            required: expectOptionalBoolean(importRecord.required, `${field}.required`, manifestPath),
            onChange: parseBrokerChangeReaction(importRecord.onChange, `${field}.onChange`, manifestPath),
          };
        })
      : undefined,
    exports: Array.isArray(exports)
      ? exports.map((entry, index) => {
          const field = `broker.exports[${index}]`;
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an object.`);
          }
          const exportRecord = entry as Record<string, unknown>;
          return {
            namespace: expectBrokerNamespace(exportRecord.namespace, `${field}.namespace`, manifestPath),
            ref: expectBrokerRef(exportRecord.ref, `${field}.ref`, manifestPath),
            source: expectNonEmptyString(exportRecord.source, `${field}.source`, manifestPath),
            required: expectOptionalBoolean(exportRecord.required, `${field}.required`, manifestPath),
          };
      })
      : undefined,
    accessPolicy: accessPolicyRecord
      ? {
          serviceId: accessPolicyServiceId,
          workspace: accessPolicyWorkspace,
          grants: parsedAccessPolicyGrants,
        }
      : undefined,
    writeback: writebackRecord
      ? {
          allowedNamespaces,
          allowedOperations: allowedOperations as ServiceBrokerWritebackOperation[] | undefined,
          allowedRefs,
          allowOverwrite,
          auditReason,
          generatedSecrets: parsedGeneratedSecrets,
        }
      : undefined,
  };
}

function validateBrokerCollisions(
  broker: ServiceManifest["broker"],
  env: ServiceEnvMap | undefined,
  globalenv: ServiceEnvMap | undefined,
  manifestPath: string,
): void {
  if (!broker) {
    return;
  }

  validateUniqueEntries((broker.imports ?? []).map((entry) => entry.ref), "broker.imports.ref", manifestPath);
  validateUniqueEntries(
    (broker.imports ?? []).flatMap((entry) => (entry.as ? [entry.as] : [])),
    "broker.imports.as",
    manifestPath,
  );
  validateUniqueEntries(
    (broker.exports ?? []).map((entry) => `${entry.namespace}:${entry.ref}`),
    "broker.exports namespace/ref",
    manifestPath,
  );
  const allowedWritebackNamespaces = new Set(broker.writeback?.allowedNamespaces ?? []);
  const allowedWritebackRefs = new Set(broker.writeback?.allowedRefs ?? []);
  const allowedWritebackOperations = new Set(broker.writeback?.allowedOperations ?? []);
  const accessGrants = broker.accessPolicy?.grants ?? [];
  const accessGrantAllows = (namespace: string, ref: string, operation: ServiceBrokerAccessOperation): boolean =>
    accessGrants.some((grant) => {
      if (grant.namespace !== namespace || !grant.operations.includes(operation)) {
        return false;
      }
      return (grant.refs ?? []).length === 0 || (grant.refs ?? []).includes(ref);
    });

  for (const entry of broker.imports ?? []) {
    if (broker.accessPolicy && !accessGrantAllows(entry.namespace, entry.ref, "resolve")) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: broker.imports ref "${entry.ref}" is outside broker.accessPolicy resolve grants for namespace "${entry.namespace}".`,
      );
    }
  }

  for (const entry of broker.writeback?.generatedSecrets ?? []) {
    const exportEntry = (broker.exports ?? []).find((candidate) => candidate.ref === entry.ref);
    if (!exportEntry) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: broker.writeback.generatedSecrets ref "${entry.ref}" must have a matching broker.exports entry.`,
      );
    }
    if (allowedWritebackNamespaces.size > 0 && !allowedWritebackNamespaces.has(exportEntry.namespace)) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: broker.writeback.generatedSecrets ref "${entry.ref}" targets namespace "${exportEntry.namespace}" outside broker.writeback.allowedNamespaces.`,
      );
    }
    if (allowedWritebackRefs.size > 0 && !allowedWritebackRefs.has(entry.ref)) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: broker.writeback.generatedSecrets ref "${entry.ref}" is outside broker.writeback.allowedRefs.`,
      );
    }
    if (entry.operation && allowedWritebackOperations.size > 0 && !allowedWritebackOperations.has(entry.operation)) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: broker.writeback.generatedSecrets ref "${entry.ref}" uses operation "${entry.operation}" outside broker.writeback.allowedOperations.`,
      );
    }
    const operation = entry.operation ?? "create";
    if (broker.accessPolicy && !accessGrantAllows(exportEntry.namespace, entry.ref, operation)) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: broker.writeback.generatedSecrets ref "${entry.ref}" uses operation "${operation}" outside broker.accessPolicy grants for namespace "${exportEntry.namespace}".`,
      );
    }
  }

  const envKeys = new Set(Object.keys(env ?? {}));
  const globalKeys = new Set(Object.keys(globalenv ?? {}));
  for (const entry of broker.imports ?? []) {
    if (entry.as && globalKeys.has(entry.as)) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: broker.imports.as "${entry.as}" collides with legacy globalenv output; map it through service-local env instead.`,
      );
    }
    if (entry.as && envKeys.has(entry.as) && env?.[entry.as] !== `\${${entry.ref}}`) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: broker.imports.as "${entry.as}" collides with env.${entry.as}; env values for broker imports must be exactly "\${${entry.ref}}".`,
      );
    }
  }
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
        platformRecord.sha256 !== undefined &&
        (typeof platformRecord.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(platformRecord.sha256.trim()))
      ) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}.sha256" to be a 64-character hex string when present.`,
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

      let checksum: { algorithm: "sha256"; value?: string; assetName?: string } | undefined;
      if (platformRecord.checksum !== undefined) {
        if (!platformRecord.checksum || typeof platformRecord.checksum !== "object" || Array.isArray(platformRecord.checksum)) {
          throw new Error(
            `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}.checksum" to be an object when present.`,
          );
        }

        const checksumRecord = platformRecord.checksum as Record<string, unknown>;
        if (checksumRecord.algorithm !== "sha256") {
          throw new Error(
            `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}.checksum.algorithm" to be "sha256".`,
          );
        }

        const checksumValue =
          typeof checksumRecord.value === "string" && checksumRecord.value.trim().length > 0
            ? checksumRecord.value.trim()
            : undefined;
        const checksumAssetName =
          typeof checksumRecord.assetName === "string" && checksumRecord.assetName.trim().length > 0
            ? checksumRecord.assetName.trim()
            : undefined;
        if ((checksumValue === undefined && checksumAssetName === undefined) || (checksumValue !== undefined && checksumAssetName !== undefined)) {
          throw new Error(
            `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}.checksum" to define exactly one of "value" or "assetName".`,
          );
        }

        checksum = {
          algorithm: "sha256",
          value: checksumValue,
          assetName: checksumAssetName,
        };
      }

      if (platformRecord.assetName === undefined && platformRecord.assetUrl === undefined) {
        throw new Error(
          `Invalid service manifest at ${manifestPath}: expected "artifact.platforms.${platform}" to define "assetName" and/or "assetUrl".`,
        );
      }

      const sha256 =
        typeof platformRecord.sha256 === "string" ? platformRecord.sha256.trim().toLowerCase() : undefined;

      return [
        platform.trim(),
        {
          assetName: typeof platformRecord.assetName === "string" ? platformRecord.assetName.trim() : undefined,
          assetUrl: typeof platformRecord.assetUrl === "string" ? platformRecord.assetUrl.trim() : undefined,
          archiveType: archiveType as "zip" | "tar.gz" | "tgz",
          ...(sha256 ? { sha256 } : {}),
          command: typeof platformRecord.command === "string" ? platformRecord.command.trim() : undefined,
          args: Array.isArray(platformRecord.args) ? platformRecord.args.map((entry) => entry.trim()) : undefined,
          ...(checksum ? { checksum } : {}),
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
  const serviceId = validateServiceId(record.id, manifestPath);

  if (record.schedules !== undefined) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: top-level "schedules" are not supported; define schedules under "actions.<actionId>.schedules".`,
    );
  }

  const dependOn = record.depend_on;
  if (
    dependOn !== undefined &&
    (!Array.isArray(dependOn) || dependOn.some((dependency) => typeof dependency !== "string" || dependency.trim().length === 0))
  ) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected \"depend_on\" to be an array of non-empty strings.`);
  }

  const requires = readStringMap(record.requires, "requires", manifestPath);
  const provides = readStringMap(record.provides, "provides", manifestPath);

  const rawServiceOrder = expectOptionalWholeNumber(record.serviceorder, "serviceorder", manifestPath, 0);
  const execconfig = readExecutionConfig(record.execconfig, manifestPath);
  const serviceorder = rawServiceOrder ?? execconfig?.serviceorder;

  const rawHealthcheck = record.healthcheck;
  const rawHealthchecks = record.healthchecks;
  let healthcheck: ServiceHealthcheck | undefined;
  let healthchecks: ServiceHealthcheck[] | undefined;

  if (rawHealthcheck !== undefined && rawHealthchecks !== undefined) {
    throw new Error(`Invalid service manifest at ${manifestPath}: use either "healthcheck" or "healthchecks", not both.`);
  }

  if (rawHealthcheck !== undefined) {
    healthcheck = readHealthcheckRecord(rawHealthcheck, manifestPath);
  }

  if (rawHealthchecks !== undefined) {
    if (!Array.isArray(rawHealthchecks)) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "healthchecks" to be an array.`);
    }

    if (rawHealthchecks.length === 0) {
      throw new Error(`Invalid service manifest at ${manifestPath}: expected "healthchecks" to contain at least one item.`);
    }

    const healthcheckIds = new Set<string>();
    healthchecks = rawHealthchecks.map((entry, index) => {
      const fieldPrefix = `healthchecks[${index}]`;
      const healthcheckEntry = readHealthcheckRecord(entry, manifestPath, fieldPrefix, {
        requireId: true,
        defaultRequired: true,
      });
      const id = healthcheckEntry.id as string;
      if (healthcheckIds.has(id)) {
        throw new Error(`Invalid service manifest at ${manifestPath}: duplicate healthchecks id "${id}".`);
      }
      healthcheckIds.add(id);
      return healthcheckEntry;
    });
    if (record.role === "provider") {
      healthcheck = healthchecks.find((entry) => entry.required !== false && entry.type !== "process");
    } else {
      healthcheck = healthchecks.find((entry) => entry.required !== false) ?? healthchecks[0];
    }
  }

  const env = readEnvMap(record.env, "env", manifestPath);
  const globalenv = readEnvMap(record.globalenv, "globalenv", manifestPath);

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

  const rawPortmapping = record.portmapping;
  if (
    rawPortmapping !== undefined &&
    (!rawPortmapping ||
      typeof rawPortmapping !== "object" ||
      Array.isArray(rawPortmapping) ||
      Object.values(rawPortmapping).some((value) => typeof value !== "string" && typeof value !== "number"))
  ) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected \"portmapping\" to be a string or number map.`);
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

  const rawCommandline = record.commandline;
  if (
    rawCommandline !== undefined &&
    (!rawCommandline ||
      typeof rawCommandline !== "object" ||
      Array.isArray(rawCommandline) ||
      Object.values(rawCommandline).some((entry) => typeof entry !== "string"))
  ) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected \"commandline\" to be a string map.`);
  }

  const rawRole = record.role;
  if (rawRole !== undefined && (typeof rawRole !== "string" || !serviceRoles.has(rawRole))) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "role" to be one of "service" or "provider".`);
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

  const logSources = readLogSources(record.logSources, manifestPath);
  const broker = readBrokerPolicy(record.broker, manifestPath, serviceId);
  const endpoints = readManifestEndpoints(record.endpoints, manifestPath);
  const outputvarregex = readOutputVarRegex(record.outputvarregex, manifestPath);
  validateBrokerCollisions(broker, env, globalenv, manifestPath);
  const artifact = readArtifact(record.artifact, manifestPath);
  const install = readActionMaterialization(record.install, "install", manifestPath);
  const config = readActionMaterialization(record.config, "config", manifestPath);
  const monitoring = readMonitoringPolicy(record.monitoring, manifestPath);
  const restartPolicy = readRestartPolicy(record.restartPolicy, manifestPath);
  const doctor = readDoctorPolicy(record.doctor, manifestPath);
  const hooks = readLifecycleHooks(record.hooks, manifestPath);
  const actions = readActionPolicy(record.actions, manifestPath);
  const setup = readSetupPolicy(record.setup, manifestPath);
  const files = readFilesPolicy(record.files, manifestPath);
  const updates = readUpdatePolicy(record.updates, artifact, manifestPath);
  const normalizedDependOn = dependOn?.map((dependency) => dependency.trim());
  const execservice = typeof rawExecservice === "string" ? rawExecservice.trim() : undefined;
  const declaredDependencies = new Set(normalizedDependOn ?? []);

  if (execservice && !declaredDependencies.has(execservice)) {
    throw new Error(
      `Invalid service manifest at ${manifestPath}: "execservice" provider "${execservice}" must be declared in "depend_on".`,
    );
  }

  for (const [stepId, step] of Object.entries(setup?.steps ?? {})) {
    if (
      step.execservice &&
      !declaredDependencies.has(step.execservice) &&
      !(step.depend_on ?? []).includes(step.execservice)
    ) {
      throw new Error(
        `Invalid service manifest at ${manifestPath}: "setup.steps.${stepId}.execservice" provider "${step.execservice}" must be declared in service "depend_on" or "setup.steps.${stepId}.depend_on".`,
      );
    }
  }

  return {
    id: serviceId,
    name: expectNonEmptyString(record.name, "name", manifestPath),
    description: expectNonEmptyString(record.description, "description", manifestPath),
    version: typeof record.version === "string" ? record.version : undefined,
    role: rawRole as ServiceManifest["role"],
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    autostart: typeof record.autostart === "boolean" ? record.autostart : undefined,
    serviceorder,
    execconfig,
    depend_on: normalizedDependOn,
    requires,
    provides,
    healthcheck,
    healthchecks,
    outputvarregex,
    env,
    globalenv,
    broker,
    endpoints,
    ports: rawPorts
      ? Object.fromEntries(Object.entries(rawPorts as Record<string, number>).map(([key, value]) => [key.trim(), value]))
      : undefined,
    portmapping: rawPortmapping
      ? Object.fromEntries(
          Object.entries(rawPortmapping as Record<string, string | number>).map(([key, value]) => [
            key.trim(),
            String(value),
          ]),
        )
      : undefined,
    urls: rawUrls?.map((entry) => ({
      label: (entry as Record<string, string>).label.trim(),
      url: (entry as Record<string, string>).url.trim(),
      kind: typeof (entry as Record<string, unknown>).kind === "string" ? ((entry as Record<string, string>).kind).trim() : undefined,
    })),
    logSources,
    monitoring,
    restartPolicy,
    doctor,
    hooks,
    actions,
    setup,
    files,
    updates,
    artifact,
    install,
    config,
    execservice,
    executable: typeof rawExecutable === "string" ? rawExecutable.trim() : undefined,
    args: rawArgs?.map((entry) => entry.trim()),
    commandline: rawCommandline
      ? Object.fromEntries(
          Object.entries(rawCommandline as Record<string, string>).map(([key, value]) => [key.trim(), value]),
        )
      : undefined,
  };
}
