import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type WorkflowPackageSourceKind = "official" | "custom";
export type WorkflowPackageSupportLevel = "core-supported" | "community" | "local" | "unsupported";

export type WorkflowPackageRepository = {
  repo: string;
  ref: string;
  path?: string;
};

export type WorkflowPackageEngineRequirement = {
  engine: "dagu" | "service-lasso" | "custom";
  versionRange: string;
};

export type WorkflowPackageTool = {
  id: string;
  command: string;
  description?: string;
};

export type WorkflowPackageConfig = {
  path: string;
  description?: string;
  required?: boolean;
};

export type WorkflowPackageSecretRef = {
  ref: string;
  namespace: string;
  description?: string;
  required?: boolean;
};

export type WorkflowPackageSchedule = {
  id: string;
  cron: string;
  timezone?: string;
};

export type WorkflowPackageValidationCommand = {
  name: string;
  command: string;
  args?: string[];
};

export type WorkflowPackageMetadata = {
  id: string;
  version: string;
  displayName: string;
  owner: string;
  source: WorkflowPackageSourceKind;
  supportLevel: WorkflowPackageSupportLevel;
  repository: WorkflowPackageRepository;
  engine: WorkflowPackageEngineRequirement;
  workflows: string[];
  tools?: WorkflowPackageTool[];
  configs?: WorkflowPackageConfig[];
  secrets?: WorkflowPackageSecretRef[];
  schedules?: WorkflowPackageSchedule[];
  validation?: WorkflowPackageValidationCommand[];
  warnings?: string[];
};

export type WorkflowCatalogEntry = {
  metadata: WorkflowPackageMetadata;
  metadataPath: string;
};

export type WorkflowCatalogDiagnosticCode =
  | "invalid-json"
  | "missing-field"
  | "invalid-field"
  | "invalid-namespace"
  | "secret-material"
  | "id-collision"
  | "workflow-collision"
  | "config-path-collision"
  | "tool-collision";

export type WorkflowCatalogDiagnostic = {
  code: WorkflowCatalogDiagnosticCode;
  severity: "error" | "warning";
  packageId?: string;
  field?: string;
  message: string;
  action: string;
};

export type WorkflowCatalogValidationResult = {
  ok: boolean;
  entries: WorkflowCatalogEntry[];
  diagnostics: WorkflowCatalogDiagnostic[];
};

export const workflowPackageCatalogEndpoints = {
  list: "GET /api/platform/workflow-packages",
  validate: "POST /api/platform/workflow-packages/validate",
} as const;

const workflowPackageIdPattern = /^(official|custom)\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const workflowIdPattern = /^(official|custom)\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*\/[a-z][a-z0-9-]*$/;
const configPathPattern = /^(official|custom)\/[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)*\.ya?ml$/;
const toolIdPattern = /^(official|custom)\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*\.[a-z][a-z0-9-]*$/;
const secretRefPattern = /^[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const namespacePattern = /^[A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/;
const secretLikePattern = /(sk-[a-z0-9]{8,}|ghp_[a-z0-9]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|correct-horse-battery-staple|raw-workflow-secret|access-token|refresh-token|client_secret=|password=)/i;

export const workflowCatalogNamespacePolicy = {
  official: {
    idPrefix: "official.",
    workflowPrefix: "official.",
    configPathPrefix: "official/",
    toolPrefix: "official.",
    outputDirPrefix: "outputs/official/",
    overridePolicy: "Official package content is immutable in place; custom packages must add overlays with custom.* ids.",
  },
  custom: {
    idPrefix: "custom.",
    workflowPrefix: "custom.",
    configPathPrefix: "custom/",
    toolPrefix: "custom.",
    outputDirPrefix: "outputs/custom/",
    overridePolicy: "Custom packages are additive overlays and cannot reuse official workflow ids, config paths, or tool ids.",
  },
} as const;

export const exampleWorkflowPackageCatalog: WorkflowCatalogEntry[] = [
  {
    metadataPath: "fixtures/workflow-catalog/official/core-maintenance/workflow-package.json",
    metadata: {
      id: "official.core.maintenance",
      version: "2026.5.8",
      displayName: "Core maintenance workflows",
      owner: "service-lasso",
      source: "official",
      supportLevel: "core-supported",
      repository: {
        repo: "service-lasso/workflows-core",
        ref: "2026.5.8",
        path: "packages/core-maintenance",
      },
      engine: {
        engine: "dagu",
        versionRange: ">=1.16.0",
      },
      workflows: ["official.core.maintenance/backup-check", "official.core.maintenance/update-check"],
      tools: [
        {
          id: "official.core.maintenance.service-lasso-cli",
          command: "service-lasso",
          description: "Invoke Service Lasso CLI checks.",
        },
      ],
      configs: [
        {
          path: "official/core-maintenance/defaults.yaml",
          description: "Safe defaults for core maintenance workflows.",
          required: true,
        },
      ],
      secrets: [
        {
          namespace: "workflows/core-maintenance",
          ref: "maintenance.API_TOKEN",
          description: "Broker reference only; value is resolved at run time.",
          required: false,
        },
      ],
      schedules: [
        {
          id: "daily-backup-check",
          cron: "0 3 * * *",
          timezone: "UTC",
        },
      ],
      validation: [
        {
          name: "validate package metadata",
          command: "service-lasso",
          args: ["workflow", "validate", "official.core.maintenance"],
        },
      ],
    },
  },
  {
    metadataPath: "fixtures/workflow-catalog/custom/local-reporting/workflow-package.json",
    metadata: {
      id: "custom.local.reporting",
      version: "0.1.0",
      displayName: "Local reporting overlays",
      owner: "local-operator",
      source: "custom",
      supportLevel: "local",
      repository: {
        repo: "file://./workflows/custom-reporting",
        ref: "main",
      },
      engine: {
        engine: "dagu",
        versionRange: ">=1.16.0",
      },
      workflows: ["custom.local.reporting/monthly-summary"],
      tools: [
        {
          id: "custom.local.reporting.report-export",
          command: "report-export",
        },
      ],
      configs: [
        {
          path: "custom/local-reporting/defaults.yaml",
          required: true,
        },
      ],
      secrets: [
        {
          namespace: "workflows/custom/local-reporting",
          ref: "reporting.API_TOKEN",
          required: true,
        },
      ],
      validation: [
        {
          name: "validate custom reporting",
          command: "dagu",
          args: ["validate", "custom.local.reporting/monthly-summary"],
        },
      ],
      warnings: ["Local custom package support is operator-owned."],
    },
  },
];

export async function loadWorkflowCatalogFromDirectories(
  roots: Array<{ root: string; source: WorkflowPackageSourceKind }>,
): Promise<WorkflowCatalogValidationResult> {
  const entries: WorkflowCatalogEntry[] = [];
  const diagnostics: WorkflowCatalogDiagnostic[] = [];

  for (const { root, source } of roots) {
    let children;
    try {
      children = await readdir(root, { withFileTypes: true });
    } catch {
      diagnostics.push({
        code: "missing-field",
        severity: "warning",
        field: root,
        message: `Workflow catalog root ${root} is not readable.`,
        action: "Create the catalog root or remove it from configured workflow package roots.",
      });
      continue;
    }

    for (const child of children.filter((entry) => entry.isDirectory())) {
      const metadataPath = path.join(root, child.name, "workflow-package.json");
      try {
        const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as WorkflowPackageMetadata;
        entries.push({ metadata: { ...parsed, source }, metadataPath });
      } catch (error) {
        diagnostics.push({
          code: "invalid-json",
          severity: "error",
          field: metadataPath,
          message: `Workflow package metadata could not be loaded: ${(error as Error).message}`,
          action: "Fix workflow-package.json so it is valid JSON and matches the workflow package contract.",
        });
      }
    }
  }

  const validation = validateWorkflowCatalogEntries(entries);
  return {
    ok: diagnostics.length === 0 && validation.ok,
    entries: validation.entries,
    diagnostics: [...diagnostics, ...validation.diagnostics],
  };
}

export function validateWorkflowCatalogEntries(entries: WorkflowCatalogEntry[]): WorkflowCatalogValidationResult {
  const diagnostics: WorkflowCatalogDiagnostic[] = [];
  const ids = new Map<string, string>();
  const workflows = new Map<string, string>();
  const configs = new Map<string, string>();
  const tools = new Map<string, string>();

  for (const entry of entries) {
    diagnostics.push(...validateWorkflowPackageMetadata(entry.metadata, entry.metadataPath));
    addCollisionDiagnostic(ids, entry.metadata.id, entry.metadata.id, "id-collision", diagnostics);
    for (const workflowId of entry.metadata.workflows ?? []) {
      addCollisionDiagnostic(workflows, workflowId, entry.metadata.id, "workflow-collision", diagnostics);
    }
    for (const config of entry.metadata.configs ?? []) {
      addCollisionDiagnostic(configs, config.path, entry.metadata.id, "config-path-collision", diagnostics);
    }
    for (const tool of entry.metadata.tools ?? []) {
      addCollisionDiagnostic(tools, tool.id, entry.metadata.id, "tool-collision", diagnostics);
    }
  }

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    entries,
    diagnostics,
  };
}

export function validateWorkflowPackageMetadata(
  metadata: WorkflowPackageMetadata,
  metadataPath = "workflow-package.json",
): WorkflowCatalogDiagnostic[] {
  const diagnostics: WorkflowCatalogDiagnostic[] = [];
  const requiredStringFields: Array<keyof WorkflowPackageMetadata> = ["id", "version", "displayName", "owner"];
  for (const field of requiredStringFields) {
    if (typeof metadata[field] !== "string" || (metadata[field] as string).trim().length === 0) {
      diagnostics.push(missingFieldDiagnostic(metadata.id, String(field), metadataPath, `Add a non-empty ${String(field)} to workflow-package.json.`));
    }
  }

  if (metadata.source !== "official" && metadata.source !== "custom") {
    diagnostics.push({
      code: "invalid-field",
      severity: "error",
      packageId: metadata.id,
      field: "source",
      message: `Workflow package metadata at ${metadataPath} must declare source as "official" or "custom".`,
      action: "Set source to official for Service Lasso-owned packages or custom for additive operator-owned packages.",
    });
  }

  if (!metadata.repository || typeof metadata.repository !== "object") {
    diagnostics.push(missingFieldDiagnostic(metadata.id, "repository", metadataPath, "Add repository metadata with non-empty repo and ref fields."));
  } else {
    if (typeof metadata.repository.repo !== "string" || metadata.repository.repo.trim().length === 0) {
      diagnostics.push(missingFieldDiagnostic(metadata.id, "repository.repo", metadataPath, "Add the source repository slug or URL for this workflow package."));
    }
    if (typeof metadata.repository.ref !== "string" || metadata.repository.ref.trim().length === 0) {
      diagnostics.push(missingFieldDiagnostic(metadata.id, "repository.ref", metadataPath, "Add the immutable tag, branch, or commit ref for this workflow package."));
    }
  }

  if (!metadata.engine || typeof metadata.engine !== "object") {
    diagnostics.push(missingFieldDiagnostic(metadata.id, "engine", metadataPath, "Add engine metadata with non-empty engine and versionRange fields."));
  } else {
    if (!["dagu", "service-lasso", "custom"].includes(metadata.engine.engine)) {
      diagnostics.push({
        code: "invalid-field",
        severity: "error",
        packageId: metadata.id,
        field: "engine.engine",
        message: `Workflow package metadata at ${metadataPath} must declare engine as "dagu", "service-lasso", or "custom".`,
        action: "Set engine.engine to the workflow engine required to run this package.",
      });
    }
    if (typeof metadata.engine.versionRange !== "string" || metadata.engine.versionRange.trim().length === 0) {
      diagnostics.push(missingFieldDiagnostic(metadata.id, "engine.versionRange", metadataPath, "Add the supported workflow engine version range."));
    }
  }

  const namespacePolicy = metadata.source === "official" || metadata.source === "custom" ? workflowCatalogNamespacePolicy[metadata.source] : undefined;
  if (!workflowPackageIdPattern.test(metadata.id) || (namespacePolicy && !metadata.id.startsWith(namespacePolicy.idPrefix))) {
    const sourceLabel = metadata.source === "official" || metadata.source === "custom" ? metadata.source : "official/custom";
    diagnostics.push(namespaceDiagnostic(metadata.id, "id", metadata.id, `Use ${sourceLabel}.* package ids, for example ${sourceLabel}.team.package.`));
  }

  if (!Array.isArray(metadata.workflows) || metadata.workflows.length === 0) {
    diagnostics.push({
      code: "missing-field",
      severity: "error",
      packageId: metadata.id,
      field: "workflows",
      message: `Workflow package ${metadata.id} must declare at least one workflow id.`,
      action: "Add a non-empty workflows array to workflow-package.json.",
    });
  } else {
    for (const workflowId of metadata.workflows) {
      if (!workflowIdPattern.test(workflowId) || (namespacePolicy && !workflowId.startsWith(namespacePolicy.workflowPrefix)) || !workflowId.startsWith(`${metadata.id}/`)) {
        diagnostics.push(namespaceDiagnostic(metadata.id, "workflows", workflowId, `Use workflow ids under ${metadata.id}/name.`));
      }
    }
  }

  for (const config of metadata.configs ?? []) {
    if (!configPathPattern.test(config.path) || (namespacePolicy && !config.path.startsWith(namespacePolicy.configPathPrefix))) {
      const sourceLabel = metadata.source === "official" || metadata.source === "custom" ? metadata.source : "official or custom";
      diagnostics.push(namespaceDiagnostic(metadata.id, "configs.path", config.path, `Use ${sourceLabel}/.../*.yaml config paths.`));
    }
  }

  for (const tool of metadata.tools ?? []) {
    if (!toolIdPattern.test(tool.id) || (namespacePolicy && !tool.id.startsWith(namespacePolicy.toolPrefix))) {
      const sourceLabel = metadata.source === "official" || metadata.source === "custom" ? metadata.source : "official/custom";
      diagnostics.push(namespaceDiagnostic(metadata.id, "tools.id", tool.id, `Use ${sourceLabel}.* tool ids.`));
    }
  }

  for (const secret of metadata.secrets ?? []) {
    if (!namespacePattern.test(secret.namespace) || !secretRefPattern.test(secret.ref)) {
      diagnostics.push(namespaceDiagnostic(metadata.id, "secrets", `${secret.namespace}:${secret.ref}`, "Use broker namespace metadata plus dotted secret refs only."));
    }
  }

  try {
    assertWorkflowCatalogSecretSafe(metadata);
  } catch (error) {
    diagnostics.push({
      code: "secret-material",
      severity: "error",
      packageId: metadata.id,
      message: (error as Error).message,
      action: "Replace raw secret material with broker/source refs before committing workflow package metadata.",
    });
  }

  return diagnostics;
}

function missingFieldDiagnostic(
  packageId: string | undefined,
  field: string,
  metadataPath: string,
  action: string,
): WorkflowCatalogDiagnostic {
  return {
    code: "missing-field",
    severity: "error",
    packageId,
    field,
    message: `Workflow package metadata at ${metadataPath} is missing required field ${field}.`,
    action,
  };
}

function addCollisionDiagnostic(
  seen: Map<string, string>,
  value: string,
  packageId: string,
  code: Extract<WorkflowCatalogDiagnosticCode, "id-collision" | "workflow-collision" | "config-path-collision" | "tool-collision">,
  diagnostics: WorkflowCatalogDiagnostic[],
): void {
  const prior = seen.get(value);
  if (prior && prior !== packageId) {
    diagnostics.push({
      code,
      severity: "error",
      packageId,
      field: value,
      message: `Workflow catalog collision for ${value}: ${prior} and ${packageId} both claim it.`,
      action: "Rename the custom package id/workflow/config/tool so it is additive and does not override existing catalog content in place.",
    });
    return;
  }
  seen.set(value, packageId);
}

function namespaceDiagnostic(packageId: string | undefined, field: string, value: string, action: string): WorkflowCatalogDiagnostic {
  return {
    code: "invalid-namespace",
    severity: "error",
    packageId,
    field,
    message: `Invalid workflow package namespace for ${field}: ${value}.`,
    action,
  };
}

export function listWorkflowPackagesSecretSafe(entries: WorkflowCatalogEntry[]): WorkflowPackageMetadata[] {
  const packages = entries.map((entry) => entry.metadata);
  assertWorkflowCatalogSecretSafe(packages);
  return packages;
}

export function assertWorkflowCatalogSecretSafe(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  if (secretLikePattern.test(serialized)) {
    throw new Error("Workflow package catalog payload contains secret-like material");
  }
}
