import type {
  ServiceBrokerBucketKind,
  ServiceBrokerWritebackOperation,
  ServiceHookFailurePolicy,
  ServiceHookStep,
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
const brokerWritebackOperations = new Set(["create", "update", "rotate", "delete"]);
const brokerBucketKinds = new Set(["service", "app", "shared", "global"]);
const brokerNamespacePattern = /^[A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/;
const brokerRefPattern = /^[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_.-]*$/;

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

function readNonEmptyStringArray(value: unknown, field: string, manifestPath: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an array of non-empty strings.`);
  }

  return value.map((entry) => (entry as string).trim());
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
          execservice: typeof step.execservice === "string" ? step.execservice.trim() : undefined,
          executable: typeof step.executable === "string" ? step.executable.trim() : undefined,
          args: Array.isArray(args) ? args.map((entry) => entry.trim()) : undefined,
          commandline: readStringMap(step.commandline, `setup.steps.${normalizedStepId}.commandline`, manifestPath),
          env: readStringMap(step.env, `setup.steps.${normalizedStepId}.env`, manifestPath),
          timeoutSeconds: expectOptionalWholeNumber(
            step.timeoutSeconds,
            `setup.steps.${normalizedStepId}.timeoutSeconds`,
            manifestPath,
            1,
          ),
          rerun: rawRerun as ServiceSetupRerunPolicy | undefined,
        },
      ];
    }),
  );

  return { steps };
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

function readBrokerPolicy(value: unknown, manifestPath: string): ServiceManifest["broker"] | undefined {
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
    writeback: writebackRecord
      ? {
          allowedNamespaces,
          allowedOperations: allowedOperations as ServiceBrokerWritebackOperation[] | undefined,
        }
      : undefined,
  };
}

function validateBrokerCollisions(
  broker: ServiceManifest["broker"],
  env: Record<string, string> | undefined,
  globalenv: Record<string, string> | undefined,
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

  const broker = readBrokerPolicy(record.broker, manifestPath);
  const env = rawEnv ? Object.fromEntries(Object.entries(rawEnv as Record<string, string>).map(([key, value]) => [key.trim(), value])) : undefined;
  const globalenv = rawGlobalEnv
    ? Object.fromEntries(Object.entries(rawGlobalEnv as Record<string, string>).map(([key, value]) => [key.trim(), value]))
    : undefined;
  validateBrokerCollisions(broker, env, globalenv, manifestPath);
  const artifact = readArtifact(record.artifact, manifestPath);
  const install = readActionMaterialization(record.install, "install", manifestPath);
  const config = readActionMaterialization(record.config, "config", manifestPath);
  const monitoring = readMonitoringPolicy(record.monitoring, manifestPath);
  const restartPolicy = readRestartPolicy(record.restartPolicy, manifestPath);
  const doctor = readDoctorPolicy(record.doctor, manifestPath);
  const hooks = readLifecycleHooks(record.hooks, manifestPath);
  const setup = readSetupPolicy(record.setup, manifestPath);
  const updates = readUpdatePolicy(record.updates, artifact, manifestPath);

  return {
    id: expectNonEmptyString(record.id, "id", manifestPath),
    name: expectNonEmptyString(record.name, "name", manifestPath),
    description: expectNonEmptyString(record.description, "description", manifestPath),
    version: typeof record.version === "string" ? record.version : undefined,
    role: rawRole as ServiceManifest["role"],
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    autostart: typeof record.autostart === "boolean" ? record.autostart : undefined,
    depend_on: dependOn?.map((dependency) => dependency.trim()),
    healthcheck,
    env,
    globalenv,
    broker,
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
    monitoring,
    restartPolicy,
    doctor,
    hooks,
    setup,
    updates,
    artifact,
    install,
    config,
    execservice: typeof rawExecservice === "string" ? rawExecservice.trim() : undefined,
    executable: typeof rawExecutable === "string" ? rawExecutable.trim() : undefined,
    args: rawArgs?.map((entry) => entry.trim()),
    commandline: rawCommandline
      ? Object.fromEntries(
          Object.entries(rawCommandline as Record<string, string>).map(([key, value]) => [key.trim(), value]),
        )
      : undefined,
  };
}
