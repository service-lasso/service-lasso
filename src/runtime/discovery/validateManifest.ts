import type {
  ServiceHookFailurePolicy,
  ServiceHookStep,
  ServiceActionConcurrencyPolicy,
  ServiceActionFailurePolicy,
  ServiceActionMode,
  ServiceActionPayloadJsonType,
  ServiceActionPayloadSchema,
  ServiceActionRequiredState,
  ServiceActionWorkflowStep,
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

function readBrokerPolicy(value: unknown, manifestPath: string): ServiceManifest["broker"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "broker" to be an object.`);
  }

  return value as ServiceManifest["broker"];
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

function readStringArray(value: unknown, field: string, manifestPath: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new Error(`Invalid service manifest at ${manifestPath}: expected "${field}" to be an array of non-empty strings.`);
  }

  return value.map((entry) => entry.trim());
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
          env: readStringMap(action.env, `${actionField}.env`, manifestPath),
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

  const artifact = readArtifact(record.artifact, manifestPath);
  const install = readActionMaterialization(record.install, "install", manifestPath);
  const config = readActionMaterialization(record.config, "config", manifestPath);
  const monitoring = readMonitoringPolicy(record.monitoring, manifestPath);
  const restartPolicy = readRestartPolicy(record.restartPolicy, manifestPath);
  const doctor = readDoctorPolicy(record.doctor, manifestPath);
  const hooks = readLifecycleHooks(record.hooks, manifestPath);
  const actions = readActionPolicy(record.actions, manifestPath);
  const setup = readSetupPolicy(record.setup, manifestPath);
  const updates = readUpdatePolicy(record.updates, artifact, manifestPath);
  const broker = readBrokerPolicy(record.broker, manifestPath);

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
    env: rawEnv ? Object.fromEntries(Object.entries(rawEnv as Record<string, string>).map(([key, value]) => [key.trim(), value])) : undefined,
    globalenv: rawGlobalEnv
      ? Object.fromEntries(Object.entries(rawGlobalEnv as Record<string, string>).map(([key, value]) => [key.trim(), value]))
      : undefined,
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
    actions,
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
