import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";
import { resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import type { DiscoveredService } from "../../contracts/service.js";

const execFileAsync = promisify(execFile);

export type ReadinessGateStatus = "ready" | "partial" | "blocked";

export interface ReadinessGateBlocker {
  gate: "runtime.servicesRoot" | "runtime.manifests" | "baseline.services" | "providers";
  id: string;
  serviceId?: string;
  message: string;
  nextAction: string;
}

export interface ReadinessGateWarning {
  gate: "workspace.git" | "baseline.services";
  id: string;
  message: string;
  nextAction: string;
}

export interface ReadinessGateGitHints {
  available: boolean;
  root: string | null;
  branch: string | null;
  upstream: string | null;
  head: string | null;
  clean: boolean | null;
  statusEntries: number;
  hints: string[];
}

export interface ReadinessGateCliResult {
  action: "gate";
  generatedAt: string;
  ok: boolean;
  status: ReadinessGateStatus;
  servicesRoot: string;
  workspaceRoot: string;
  baseline: {
    startPossible: boolean;
    status: Exclude<ReadinessGateStatus, "partial"> | "partial";
    totalServices: number;
    enabledServices: number;
    disabledServices: number;
    blockers: ReadinessGateBlocker[];
  };
  providers: {
    status: Exclude<ReadinessGateStatus, "partial">;
    required: string[];
    present: string[];
    missing: string[];
  };
  workspace: {
    git: ReadinessGateGitHints;
  };
  blockers: ReadinessGateBlocker[];
  warnings: ReadinessGateWarning[];
  nextAction: string;
}

export interface ReadinessGateCliOptions extends RuntimeConfigOptions {
  cwd?: string;
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function gitOutput(args: string[], cwd: string): Promise<string | null> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      timeout: 5_000,
    });
    return String(result.stdout).trim();
  } catch {
    return null;
  }
}

async function readGitHints(cwd: string): Promise<ReadinessGateGitHints> {
  const root = await gitOutput(["rev-parse", "--show-toplevel"], cwd);
  if (!root) {
    return {
      available: false,
      root: null,
      branch: null,
      upstream: null,
      head: null,
      clean: null,
      statusEntries: 0,
      hints: ["No git workspace was detected from the current directory."],
    };
  }

  const branch = await gitOutput(["branch", "--show-current"], root);
  const upstream = await gitOutput(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root);
  const head = await gitOutput(["rev-parse", "--short", "HEAD"], root);
  const porcelain = await gitOutput(["status", "--porcelain"], root);
  const statusEntries = porcelain ? porcelain.split(/\r?\n/).filter(Boolean).length : 0;
  const hints: string[] = [];

  if (statusEntries > 0) {
    hints.push("Git workspace has uncommitted or untracked changes.");
  }
  if (!upstream) {
    hints.push("Current branch has no upstream tracking branch.");
  }

  return {
    available: true,
    root,
    branch: branch || null,
    upstream: upstream || null,
    head: head || null,
    clean: statusEntries === 0,
    statusEntries,
    hints,
  };
}

function requiredProviderIds(services: DiscoveredService[]): string[] {
  const byId = new Map(services.map((service) => [service.manifest.id, service]));
  const required = new Set<string>();

  for (const service of services) {
    if (service.manifest.enabled === false) {
      continue;
    }

    for (const dependencyId of service.manifest.depend_on ?? []) {
      const dependency = byId.get(dependencyId);
      if (!dependency || dependency.manifest.role === "provider") {
        required.add(dependencyId);
      }
    }
  }

  return [...required].sort((left, right) => left.localeCompare(right));
}

function createNextAction(blockers: ReadinessGateBlocker[], warnings: ReadinessGateWarning[]): string {
  const firstBlocker = blockers[0];
  if (firstBlocker) {
    return firstBlocker.nextAction;
  }

  const firstWarning = warnings[0];
  if (firstWarning) {
    return firstWarning.nextAction;
  }

  return "Run `service-lasso start --json` or continue with the next automation step.";
}

export async function runReadinessGateCliAction(options: ReadinessGateCliOptions = {}): Promise<ReadinessGateCliResult> {
  const runtimeConfig = resolveRuntimeConfig({
    servicesRoot: options.servicesRoot,
    workspaceRoot: options.workspaceRoot,
    version: options.version,
  });
  const blockers: ReadinessGateBlocker[] = [];
  const warnings: ReadinessGateWarning[] = [];
  const git = await readGitHints(options.cwd ?? process.cwd());

  if (git.clean === false) {
    warnings.push({
      gate: "workspace.git",
      id: "git_dirty",
      message: "Git workspace has uncommitted or untracked changes.",
      nextAction: "Commit, stash, or intentionally ignore the local changes before release automation.",
    });
  }

  let services: DiscoveredService[] = [];

  if (!(await directoryExists(runtimeConfig.servicesRoot))) {
    blockers.push({
      gate: "runtime.servicesRoot",
      id: "services_root_missing",
      message: "Configured servicesRoot does not exist: " + runtimeConfig.servicesRoot,
      nextAction: "Create the services root or pass --services-root to the intended Service Lasso services directory.",
    });
  } else {
    try {
      services = await discoverServices(runtimeConfig.servicesRoot);
    } catch (error) {
      blockers.push({
        gate: "runtime.manifests",
        id: "manifest_discovery_failed",
        message: error instanceof Error ? error.message : String(error),
        nextAction: "Fix the service manifest error and rerun the readiness gate.",
      });
    }
  }

  const registry = createServiceRegistry(services);
  const enabledServices = services.filter((service) => service.manifest.enabled !== false);
  const disabledServices = services.length - enabledServices.length;
  if (
    enabledServices.length === 0 &&
    blockers.every((blocker) => blocker.gate !== "runtime.servicesRoot" && blocker.gate !== "runtime.manifests")
  ) {
    blockers.push({
      gate: "baseline.services",
      id: "no_enabled_services",
      message: "No enabled services were discovered for baseline start.",
      nextAction: "Enable at least one baseline service or point --services-root at a populated service directory.",
    });
  }
  if (disabledServices > 0) {
    warnings.push({
      gate: "baseline.services",
      id: "disabled_services_present",
      message: `${disabledServices} disabled service(s) were discovered and will not be included in baseline start.`,
      nextAction: "Review disabled service manifests if baseline coverage looks incomplete.",
    });
  }

  const requiredProviders = requiredProviderIds(services);
  const presentProviders = services
    .filter((service) => service.manifest.role === "provider")
    .map((service) => service.manifest.id)
    .sort((left, right) => left.localeCompare(right));
  const missingProviders = requiredProviders.filter((providerId) => !registry.getById(providerId));

  for (const providerId of missingProviders) {
    blockers.push({
      gate: "providers",
      id: "required_provider_missing",
      serviceId: providerId,
      message: "Required provider manifest is missing: " + providerId,
      nextAction: "Restore or import the missing provider manifest before baseline start.",
    });
  }

  const baselineBlockers = blockers;
  const baselineStatus: ReadinessGateCliResult["baseline"]["status"] =
    baselineBlockers.length > 0 ? "blocked" : warnings.some((warning) => warning.gate === "baseline.services") ? "partial" : "ready";
  const status: ReadinessGateStatus = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "partial" : "ready";

  return {
    action: "gate",
    generatedAt: new Date().toISOString(),
    ok: blockers.length === 0,
    status,
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    baseline: {
      startPossible: baselineBlockers.length === 0,
      status: baselineStatus,
      totalServices: services.length,
      enabledServices: enabledServices.length,
      disabledServices,
      blockers: baselineBlockers,
    },
    providers: {
      status: missingProviders.length > 0 ? "blocked" : "ready",
      required: requiredProviders,
      present: presentProviders,
      missing: missingProviders,
    },
    workspace: {
      git,
    },
    blockers,
    warnings,
    nextAction: createNextAction(blockers, warnings),
  };
}
