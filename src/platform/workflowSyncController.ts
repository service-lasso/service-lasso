import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type WorkflowCatalogDiagnostic,
  type WorkflowCatalogEntry,
  type WorkflowPackageSourceKind,
  loadWorkflowCatalogFromDirectories,
} from "./workflowCatalog.js";

export type WorkflowRepoSource = {
  id: string;
  source: WorkflowPackageSourceKind;
  repo: string;
  ref: string;
  channel?: string;
  path?: string;
};

export type WorkflowRepoSyncedRevision = {
  sourceId: string;
  source: WorkflowPackageSourceKind;
  repo: string;
  ref: string;
  channel?: string;
  revision: string;
  workspacePath: string;
  packageRoot: string;
  syncedAt: string;
};

export type WorkflowRepoActiveRevision = {
  activationId: string;
  revision: string;
  activatedAt: string;
  activeRoot: string;
  packageRoots: string[];
  sources: WorkflowRepoSyncedRevision[];
  packages: string[];
};

export type WorkflowRepoSyncState = {
  active?: WorkflowRepoActiveRevision;
  previousGood?: WorkflowRepoActiveRevision;
  failed?: {
    activationId: string;
    failedAt: string;
    reason: string;
    diagnostics: WorkflowCatalogDiagnostic[];
    attemptedSources: WorkflowRepoSyncedRevision[];
    rolledBackTo?: string;
  };
  history: Array<{
    activationId: string;
    result: "activated" | "rolled-back";
    revision: string;
    at: string;
    diagnostics: WorkflowCatalogDiagnostic[];
  }>;
};

export type WorkflowRepoFetchRequest = {
  source: WorkflowRepoSource;
  destination: string;
};

export type WorkflowRepoFetchResult = {
  revision: string;
  packageRoot?: string;
};

export type WorkflowRepoFetcher = (request: WorkflowRepoFetchRequest) => Promise<WorkflowRepoFetchResult>;

export type WorkflowRepoSyncControllerOptions = {
  workspaceRoot: string;
  statePath?: string;
  now?: () => Date;
  fetcher: WorkflowRepoFetcher;
};

export type WorkflowRepoActivationResult = {
  ok: boolean;
  state: WorkflowRepoSyncState;
  active?: WorkflowRepoActiveRevision;
  diagnostics: WorkflowCatalogDiagnostic[];
  synced: WorkflowRepoSyncedRevision[];
};

export const workflowRepoSyncEndpoints = {
  state: "GET /api/platform/workflow-repos/state",
  sync: "POST /api/platform/workflow-repos/sync",
  activate: "POST /api/platform/workflow-repos/activate",
  rollback: "POST /api/platform/workflow-repos/rollback",
} as const;

export async function activateWorkflowRepoSources(
  sources: WorkflowRepoSource[],
  options: WorkflowRepoSyncControllerOptions,
): Promise<WorkflowRepoActivationResult> {
  const now = options.now ?? (() => new Date());
  const statePath = options.statePath ?? path.join(options.workspaceRoot, "state.json");
  const previousState = await readWorkflowRepoSyncState(statePath);
  const activationId = `activation-${now().toISOString().replace(/[:.]/g, "-")}`;
  const stagingRoot = path.join(options.workspaceRoot, "staging", activationId);
  const activeRoot = path.join(options.workspaceRoot, "active", activationId);
  await mkdir(stagingRoot, { recursive: true });

  const synced: WorkflowRepoSyncedRevision[] = [];
  const diagnostics: WorkflowCatalogDiagnostic[] = [];

  if (!Array.isArray(sources) || sources.length === 0) {
    diagnostics.push({
      code: "missing-field",
      severity: "error",
      field: "sources",
      message: "Workflow repo activation requires at least one configured workflow repo source.",
      action: "Configure at least one official or custom workflow repo source with an explicit pinned ref before activation.",
    });
    return await recordWorkflowActivationFailure({
      activationId,
      statePath,
      previousState,
      reason: "workflow activation has no configured sources",
      diagnostics,
      synced,
      at: now().toISOString(),
    });
  }

  try {
    for (const source of sources) {
      validateWorkflowRepoSource(source, diagnostics);
      if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        continue;
      }
      const destination = path.join(stagingRoot, safeSegment(source.id));
      await mkdir(destination, { recursive: true });
      const fetched = await options.fetcher({ source, destination });
      const packageRoot = path.resolve(destination, fetched.packageRoot ?? source.path ?? ".");
      synced.push({
        sourceId: source.id,
        source: source.source,
        repo: source.repo,
        ref: source.ref,
        channel: source.channel,
        revision: fetched.revision,
        workspacePath: destination,
        packageRoot,
        syncedAt: now().toISOString(),
      });
    }

    const catalog = await loadWorkflowCatalogFromDirectories(synced.map((entry) => ({ root: entry.packageRoot, source: entry.source })));
    diagnostics.push(...catalog.diagnostics);
    diagnostics.push(...validateActivationRepositoryPins(catalog.entries, synced));
    diagnostics.push(...await validateDaguWorkflowDefinitions(catalog.entries));

    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return await recordWorkflowActivationFailure({
        activationId,
        statePath,
        previousState,
        reason: "workflow validation failed before activation",
        diagnostics,
        synced,
        at: now().toISOString(),
      });
    }

    await mkdir(path.dirname(activeRoot), { recursive: true });
    await rm(activeRoot, { recursive: true, force: true });
    await rename(stagingRoot, activeRoot);

    const active: WorkflowRepoActiveRevision = {
      activationId,
      revision: composeActivationRevision(synced),
      activatedAt: now().toISOString(),
      activeRoot,
      packageRoots: synced.map((entry) => path.join(activeRoot, safeSegment(entry.sourceId), path.relative(entry.workspacePath, entry.packageRoot))),
      sources: synced.map((entry) => ({ ...entry, workspacePath: path.join(activeRoot, safeSegment(entry.sourceId)), packageRoot: path.join(activeRoot, safeSegment(entry.sourceId), path.relative(entry.workspacePath, entry.packageRoot)) })),
      packages: catalog.entries.map((entry) => entry.metadata.id).sort(),
    };

    const nextState: WorkflowRepoSyncState = {
      active,
      previousGood: previousState.active ?? previousState.previousGood,
      history: [
        ...previousState.history,
        { activationId, result: "activated", revision: active.revision, at: active.activatedAt, diagnostics: [] },
      ],
    };
    await writeWorkflowRepoSyncState(statePath, nextState);
    return { ok: true, state: nextState, active, diagnostics: [], synced: active.sources };
  } catch (error) {
    diagnostics.push({
      code: "invalid-field",
      severity: "error",
      message: `Workflow activation failed before promotion: ${(error as Error).message}`,
      action: "Fix the fetch/sync source or workflow package metadata; previous active revision remains mounted.",
    });
    return await recordWorkflowActivationFailure({
      activationId,
      statePath,
      previousState,
      reason: "workflow activation failed before promotion",
      diagnostics,
      synced,
      at: now().toISOString(),
    });
  }
}

export async function rollbackWorkflowRepoActivation(options: Omit<WorkflowRepoSyncControllerOptions, "fetcher">): Promise<WorkflowRepoSyncState> {
  const statePath = options.statePath ?? path.join(options.workspaceRoot, "state.json");
  const state = await readWorkflowRepoSyncState(statePath);
  if (!state.previousGood) {
    return state;
  }
  const now = options.now ?? (() => new Date());
  const rolledBack: WorkflowRepoSyncState = {
    active: state.previousGood,
    previousGood: state.active,
    history: [
      ...state.history,
      { activationId: `rollback-${now().toISOString().replace(/[:.]/g, "-")}`, result: "rolled-back", revision: state.previousGood.revision, at: now().toISOString(), diagnostics: [] },
    ],
  };
  await writeWorkflowRepoSyncState(statePath, rolledBack);
  return rolledBack;
}

export async function readWorkflowRepoSyncState(statePath: string): Promise<WorkflowRepoSyncState> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as WorkflowRepoSyncState;
  } catch {
    return { history: [] };
  }
}

function validateWorkflowRepoSource(source: WorkflowRepoSource, diagnostics: WorkflowCatalogDiagnostic[]): void {
  for (const field of ["id", "repo", "ref"] as const) {
    if (typeof source[field] !== "string" || source[field].trim().length === 0) {
      diagnostics.push({
        code: "missing-field",
        severity: "error",
        packageId: source.id,
        field,
        message: `Workflow repo source is missing required field ${field}.`,
        action: "Configure workflow repo sources with explicit id, repo, source kind, and pinned ref/channel metadata.",
      });
    }
  }
  if (source.source !== "official" && source.source !== "custom") {
    diagnostics.push({
      code: "invalid-field",
      severity: "error",
      packageId: source.id,
      field: "source",
      message: "Workflow repo source must be official or custom.",
      action: "Use official for Service Lasso-owned workflow sources and custom for additive operator sources.",
    });
  }
  if (["main", "master", "develop", "latest", "HEAD"].includes(source.ref)) {
    diagnostics.push({
      code: "invalid-field",
      severity: "error",
      packageId: source.id,
      field: "ref",
      message: `Workflow repo source ${source.id} uses mutable ref ${source.ref}.`,
      action: "Pin workflow sync to a release tag or immutable commit; do not blindly pull main into active production state.",
    });
  }
}

async function validateDaguWorkflowDefinitions(entries: WorkflowCatalogEntry[]): Promise<WorkflowCatalogDiagnostic[]> {
  const diagnostics: WorkflowCatalogDiagnostic[] = [];
  for (const entry of entries) {
    if (entry.metadata.engine.engine !== "dagu") {
      continue;
    }
    const packageRoot = path.dirname(entry.metadataPath);
    for (const workflowId of entry.metadata.workflows ?? []) {
      const workflowName = workflowId.split("/").at(-1) ?? workflowId;
      const candidates = [
        path.join(packageRoot, "workflows", `${workflowName}.yaml`),
        path.join(packageRoot, "workflows", `${workflowName}.yml`),
        path.join(packageRoot, `${workflowName}.yaml`),
        path.join(packageRoot, `${workflowName}.yml`),
      ];
      const exists = await Promise.any(candidates.map(async (candidate) => {
        await access(candidate);
        return true;
      })).catch(() => false);
      if (!exists) {
        diagnostics.push({
          code: "missing-field",
          severity: "error",
          packageId: entry.metadata.id,
          field: "workflows",
          message: `Dagu workflow definition for ${workflowId} is missing from ${packageRoot}.`,
          action: `Add workflows/${workflowName}.yaml or workflows/${workflowName}.yml before activation.`,
        });
      }
    }
  }
  return diagnostics;
}

function validateActivationRepositoryPins(entries: WorkflowCatalogEntry[], synced: WorkflowRepoSyncedRevision[]): WorkflowCatalogDiagnostic[] {
  const diagnostics: WorkflowCatalogDiagnostic[] = [];
  for (const entry of entries) {
    const source = synced.find((candidate) => candidate.source === entry.metadata.source && candidate.repo === entry.metadata.repository.repo);
    if (!source) {
      diagnostics.push({
        code: "invalid-field",
        severity: "error",
        packageId: entry.metadata.id,
        field: "repository.repo",
        message: `Workflow package ${entry.metadata.id} came from an unconfigured repository ${entry.metadata.repository.repo}.`,
        action: "Configure the repo source explicitly before activation.",
      });
      continue;
    }
    if (entry.metadata.repository.ref !== source.ref && entry.metadata.repository.ref !== source.revision) {
      diagnostics.push({
        code: "invalid-field",
        severity: "error",
        packageId: entry.metadata.id,
        field: "repository.ref",
        message: `Workflow package ${entry.metadata.id} metadata ref ${entry.metadata.repository.ref} does not match synced ref ${source.ref}/${source.revision}.`,
        action: "Align workflow-package.json repository.ref with the pinned source ref or resolved immutable revision.",
      });
    }
  }
  return diagnostics;
}

async function recordWorkflowActivationFailure(args: {
  activationId: string;
  statePath: string;
  previousState: WorkflowRepoSyncState;
  reason: string;
  diagnostics: WorkflowCatalogDiagnostic[];
  synced: WorkflowRepoSyncedRevision[];
  at: string;
}): Promise<WorkflowRepoActivationResult> {
  const failed: WorkflowRepoSyncState = {
    ...args.previousState,
    failed: {
      activationId: args.activationId,
      failedAt: args.at,
      reason: args.reason,
      diagnostics: args.diagnostics,
      attemptedSources: args.synced,
      rolledBackTo: args.previousState.active?.revision,
    },
    history: [
      ...args.previousState.history,
      { activationId: args.activationId, result: "rolled-back", revision: args.previousState.active?.revision ?? "none", at: args.at, diagnostics: args.diagnostics },
    ],
  };
  await writeWorkflowRepoSyncState(args.statePath, failed);
  return { ok: false, state: failed, active: args.previousState.active, diagnostics: args.diagnostics, synced: args.synced };
}

async function writeWorkflowRepoSyncState(statePath: string, state: WorkflowRepoSyncState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(state, null, 2));
  await rename(tempPath, statePath);
}

function composeActivationRevision(synced: WorkflowRepoSyncedRevision[]): string {
  return synced.map((entry) => `${entry.sourceId}@${entry.revision}`).sort().join("+");
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "-");
}
