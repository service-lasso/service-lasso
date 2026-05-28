import { startRuntimeApp } from "./runtime/app.js";
import { bootstrapBaselineServices, type BootstrapBaselineResult } from "./runtime/cli/bootstrap.js";
import { runBackupCliAction, type BackupCliAction, type BackupCliResult } from "./runtime/cli/backup.js";
import { installServiceFromCli } from "./runtime/cli/install.js";
import { importServiceManifestFromCli, type ImportServiceManifestCliResult } from "./runtime/cli/importService.js";
import { runHealthCliAction, type HealthCliAction, type HealthCliResult } from "./runtime/cli/health.js";
import { runLockfileCliAction, type LockfileCliAction, type LockfileCliResult } from "./runtime/cli/lockfile.js";
import { runRecoveryCliAction, type RecoveryCliAction, type RecoveryCliResult } from "./runtime/cli/recovery.js";
import type { ServiceRecoveryHistoryState } from "./runtime/recovery/history.js";
import { runOperatorCliAction, type OperatorActionsCliAction, type OperatorCliResult } from "./runtime/cli/operator.js";
import { runSecretsCliAction, type SecretsCliAction, type SecretsCliResult } from "./runtime/cli/secrets.js";
import { runSetupCliAction, type SetupCliAction, type SetupCliResult } from "./runtime/cli/setup.js";
import { runUpdatesCliAction, type UpdateCliAction, type UpdatesCliResult } from "./runtime/cli/updates.js";
import { runConfigDriftCliAction, type ConfigDriftCliResult } from "./runtime/cli/config-drift.js";
import { runConfigApplyCliAction, type ConfigApplyCliAction, type ConfigApplyCliResult } from "./runtime/cli/config-apply.js";
import { runConfigSnapshotCliAction, type ConfigSnapshotCliAction, type ConfigSnapshotCliResult } from "./runtime/cli/config-snapshot.js";
import { runDiagnosticsCliAction, type DiagnosticsCliAction, type DiagnosticsCliResult } from "./runtime/cli/diagnostics.js";
import { readRuntimeInstanceForCli } from "./runtime/cli/instance.js";
import { runRuntimePlanCliAction, type RuntimePlanCliAction, type RuntimePlanCliResult } from "./runtime/cli/plan.js";
import type { ServiceUpdateState } from "./runtime/updates/state.js";
import { resolveRuntimeVersion } from "./runtime/version.js";
import type { RuntimeInstanceResponse } from "./contracts/api.js";

interface ParsedCliOptions {
  command: "serve" | "install" | "start" | "setup" | "updates" | "recovery" | "health" | "plan" | "lockfile" | "instance" | "config-drift" | "config-apply" | "config-snapshot" | "secrets" | "backup" | "diagnostics" | "operator" | "services" | "help" | "version";
  serviceCommand?: "import";
  setupAction?: SetupCliAction;
  updateAction?: UpdateCliAction;
  recoveryAction?: RecoveryCliAction;
  healthAction?: HealthCliAction;
  planAction?: RuntimePlanCliAction;
  lockfileAction?: LockfileCliAction;
  configApplyAction?: ConfigApplyCliAction;
  configSnapshotAction?: ConfigSnapshotCliAction;
  secretsAction?: SecretsCliAction;
  backupAction?: BackupCliAction;
  diagnosticsAction?: DiagnosticsCliAction;
  operatorActionsAction?: OperatorActionsCliAction;
  actionId?: string;
  deferredUntil?: string | null;
  serviceId?: string;
  repo?: string;
  tag?: string;
  apiBaseUrl?: string;
  manifestPath?: string;
  stepId?: string;
  archivePath?: string;
  snapshotPath?: string;
  port?: number;
  servicesRoot?: string;
  workspaceRoot?: string;
  json: boolean;
  force: boolean;
  includeManual: boolean;
  dryRun?: boolean;
  preview?: boolean;
}

function usageText(): string {
  return [
    "Service Lasso CLI",
    "",
    "Usage:",
    "  service-lasso",
    "  service-lasso serve [--port <number>] [--services-root <path>] [--workspace-root <path>]",
    "  service-lasso start [--port <number>] [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso install <serviceId> [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso setup list [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso setup run <serviceId> [stepId] [--services-root <path>] [--workspace-root <path>] [--force] [--include-manual] [--json]",
    "  service-lasso updates list [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso updates check [serviceId] [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso updates download <serviceId> [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso updates install <serviceId> [--services-root <path>] [--workspace-root <path>] [--force] [--json]",
    "  service-lasso plan start [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso plan stop [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso plan autostart [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso plan update-install <serviceId> [--services-root <path>] [--workspace-root <path>] [--force] [--json]",
    "  service-lasso plan import <manifestPath> [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso recovery status [serviceId] [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso recovery doctor <serviceId> [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso health history [serviceId] [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso instance [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso lockfile generate [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso lockfile verify [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso config-drift [serviceId] [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso config-apply preflight [serviceId] [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso config-snapshot export [serviceId] [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso config-snapshot import <snapshotPath> [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso secrets audit [serviceId] [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso backup create [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso backup restore-plan <archivePath> [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso diagnostics bundle [serviceId|baseline] --preview [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso operator actions list [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso operator actions acknowledge <actionId> [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso operator actions defer <actionId> [--until <iso>] [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso operator actions reopen <actionId> [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso services import <owner/repo> [--tag <tag>] [--services-root <path>] [--dry-run] [--force] [--json]",
    "  service-lasso help",
    "  service-lasso --version",
    "",
    "Notes:",
    "  - Running without a command starts the bounded core API runtime.",
    "  - The start command installs/configures/starts the baseline services, then leaves the API running.",
    "  - The install command acquires and installs a service from manifest-owned artifact metadata without starting it.",
    "  - The setup command lists or runs manifest-owned setup steps after install/config.",
    "  - The updates command checks, lists, downloads, or installs service update candidates.",
    "  - The plan command previews start, stop, update-install, and app-owned service import actions without writing state.",
    "  - The recovery command reads persisted recovery history or runs doctor/preflight checks.",
    "  - The instance command reads local runtime identity and recent instance registry state.",
    "  - The lockfile command generates or verifies the servicesRoot service-lasso.lock.json.",
    "  - The instance command reads local runtime identity and recent instance registry state.",
  ].join("\n");
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --port value: ${value}`);
  }
  return parsed;
}

function parseCliArgs(argv: string[]): ParsedCliOptions {
  const remaining = [...argv];
  const commandToken = remaining[0];

  if (!commandToken) {
    return { command: "serve", json: false, force: false, includeManual: false };
  }

  if (commandToken === "help" || commandToken === "--help" || commandToken === "-h") {
    return { command: "help", json: false, force: false, includeManual: false };
  }

  if (commandToken === "--version" || commandToken === "-v" || commandToken === "version") {
    return { command: "version", json: false, force: false, includeManual: false };
  }

  const command =
    commandToken === "serve" ||
      commandToken === "install" ||
      commandToken === "start" ||
      commandToken === "setup" ||
      commandToken === "updates" ||
      commandToken === "recovery" ||
      commandToken === "health" ||
      commandToken === "plan" ||
      commandToken === "lockfile" ||
      commandToken === "instance" ||
      commandToken === "config-drift" ||
      commandToken === "config-apply" ||
      commandToken === "config-snapshot" ||
      commandToken === "secrets" ||
      commandToken === "backup" ||
      commandToken === "diagnostics" ||
      commandToken === "operator" ||
      commandToken === "services"
      ? commandToken
      : null;
  if (!command) {
    throw new Error(`Unknown command: ${commandToken}`);
  }

  remaining.shift();

  const parsed: ParsedCliOptions = {
    command,
    json: false,
    force: false,
    includeManual: false,
  };

  if (command === "install") {
    const serviceId = remaining.shift();
    if (!serviceId || serviceId.startsWith("-")) {
      throw new Error('The "install" command requires a <serviceId> argument.');
    }
    parsed.serviceId = serviceId;
  }

  if (command === "updates") {
    const action = remaining.shift();
    if (action !== "list" && action !== "check" && action !== "download" && action !== "install") {
      throw new Error('The "updates" command requires one of: list, check, download, install.');
    }

    parsed.updateAction = action;
    if (action === "download" || action === "install") {
      const serviceId = remaining.shift();
      if (!serviceId || serviceId.startsWith("-")) {
        throw new Error(`The "updates ${action}" command requires a <serviceId> argument.`);
      }
      parsed.serviceId = serviceId;
    } else if (action === "check" && remaining[0] && !remaining[0].startsWith("-")) {
      parsed.serviceId = remaining.shift();
    }
  }

  if (command === "setup") {
    const action = remaining.shift();
    if (action !== "list" && action !== "run") {
      throw new Error('The "setup" command requires one of: list, run.');
    }

    parsed.setupAction = action;
    if (action === "run") {
      const serviceId = remaining.shift();
      if (!serviceId || serviceId.startsWith("-")) {
        throw new Error('The "setup run" command requires a <serviceId> argument.');
      }
      parsed.serviceId = serviceId;
      if (remaining[0] && !remaining[0].startsWith("-")) {
        parsed.stepId = remaining.shift();
      }
    }
  }

  if (command === "recovery") {
    const action = remaining.shift();
    if (action !== "status" && action !== "doctor") {
      throw new Error('The "recovery" command requires one of: status, doctor.');
    }

    parsed.recoveryAction = action;
    if (action === "doctor") {
      const serviceId = remaining.shift();
      if (!serviceId || serviceId.startsWith("-")) {
        throw new Error('The "recovery doctor" command requires a <serviceId> argument.');
      }
      parsed.serviceId = serviceId;
    } else if (remaining[0] && !remaining[0].startsWith("-")) {
      parsed.serviceId = remaining.shift();
    }
  }

  if (command === "health") {
    const action = remaining.shift();
    if (action !== "history") {
      throw new Error('The "health" command requires: history.');
    }

    parsed.healthAction = action;
    if (remaining[0] && !remaining[0].startsWith("-")) {
      parsed.serviceId = remaining.shift();
    }
  }

  if (command === "lockfile") {
    const action = remaining.shift();
    if (action !== "generate" && action !== "verify") {
      throw new Error('The "lockfile" command requires one of: generate, verify.');
    }

    parsed.lockfileAction = action;
  }

  if (command === "plan") {
    const action = remaining.shift();
    if (action !== "start" && action !== "stop" && action !== "autostart" && action !== "update-install" && action !== "import") {
      throw new Error('The "plan" command requires one of: start, stop, autostart, update-install, import.');
    }

    parsed.planAction = action;
    if (action === "update-install") {
      const serviceId = remaining.shift();
      if (!serviceId || serviceId.startsWith("-")) {
        throw new Error('The "plan update-install" command requires a <serviceId> argument.');
      }
      parsed.serviceId = serviceId;
    }
    if (action === "import") {
      const manifestPath = remaining.shift();
      if (!manifestPath || manifestPath.startsWith("-")) {
        throw new Error('The "plan import" command requires a <manifestPath> argument.');
      }
      parsed.manifestPath = manifestPath;
    }
  }

  if (command === "config-drift" && remaining[0] && !remaining[0].startsWith("-")) {
    parsed.serviceId = remaining.shift();
  }

  if (command === "config-apply") {
    const action = remaining.shift();
    if (action !== "preflight") {
      throw new Error('The "config-apply" command requires: preflight.');
    }

    parsed.configApplyAction = action;
    if (remaining[0] && !remaining[0].startsWith("-")) {
      parsed.serviceId = remaining.shift();
    }
  }

  if (command === "config-snapshot") {
    const action = remaining.shift();
    if (action !== "export" && action !== "import") {
      throw new Error('The "config-snapshot" command requires one of: export, import.');
    }

    parsed.configSnapshotAction = action;
    if (action === "export") {
      if (remaining[0] && !remaining[0].startsWith("-")) {
        parsed.serviceId = remaining.shift();
      }
    } else {
      const snapshotPath = remaining.shift();
      if (!snapshotPath || snapshotPath.startsWith("-")) {
        throw new Error('The "config-snapshot import" command requires a <snapshotPath> argument.');
      }
      parsed.snapshotPath = snapshotPath;
    }
  }

  if (command === "secrets") {
    const action = remaining.shift();
    if (action !== "audit") {
      throw new Error('The "secrets" command requires: audit.');
    }

    parsed.secretsAction = action;
    if (remaining[0] && !remaining[0].startsWith("-")) {
      parsed.serviceId = remaining.shift();
    }
  }

  if (command === "backup") {
    const action = remaining.shift();
    if (action !== "create" && action !== "restore-plan") {
      throw new Error('The "backup" command requires one of: create, restore-plan.');
    }

    parsed.backupAction = action;
    if (action === "restore-plan") {
      const archivePath = remaining.shift();
      if (!archivePath || archivePath.startsWith("-")) {
        throw new Error('The "backup restore-plan" command requires an <archivePath> argument.');
      }
      parsed.archivePath = archivePath;
    }
  }

  if (command === "diagnostics") {
    const action = remaining.shift();
    if (action !== "bundle") {
      throw new Error('The "diagnostics" command requires: bundle.');
    }

    parsed.diagnosticsAction = action;
    if (remaining[0] && !remaining[0].startsWith("-")) {
      const scope = remaining.shift();
      if (scope && scope !== "baseline") {
        parsed.serviceId = scope;
      }
    }
  }

  if (command === "operator") {
    const scope = remaining.shift();
    if (scope !== "actions") {
      throw new Error('The "operator" command requires the "actions" scope.');
    }

    const action = remaining.shift();
    if (action !== "list" && action !== "acknowledge" && action !== "defer" && action !== "reopen") {
      throw new Error('The "operator actions" command requires one of: list, acknowledge, defer, reopen.');
    }

    parsed.operatorActionsAction = action;
    if (action !== "list") {
      const actionId = remaining.shift();
      if (!actionId || actionId.startsWith("-")) {
        throw new Error(`The "operator actions ${action}" command requires an <actionId> argument.`);
      }
      parsed.actionId = actionId;
    }
  }

  if (command === "services") {
    const serviceCommand = remaining.shift();
    if (serviceCommand !== "import") {
      throw new Error('The "services" command requires one of: import.');
    }
    parsed.serviceCommand = serviceCommand;
    const repo = remaining.shift();
    if (!repo || repo.startsWith("-")) {
      throw new Error('The "services import" command requires an <owner/repo> argument.');
    }
    parsed.repo = repo;
  }

  while (remaining.length > 0) {
    const token = remaining.shift();

    switch (token) {
      case "--services-root": {
        const value = remaining.shift();
        if (!value) {
          throw new Error("Missing value for --services-root.");
        }
        parsed.servicesRoot = value;
        break;
      }
      case "--workspace-root": {
        const value = remaining.shift();
        if (!value) {
          throw new Error("Missing value for --workspace-root.");
        }
        parsed.workspaceRoot = value;
        break;
      }
      case "--port": {
        if (command !== "serve" && command !== "start") {
          throw new Error("--port is only supported for the serve and start commands.");
        }
        const value = remaining.shift();
        if (!value) {
          throw new Error("Missing value for --port.");
        }
        parsed.port = parsePort(value);
        break;
      }
      case "--json": {
        if (command !== "install" && command !== "start" && command !== "setup" && command !== "updates" && command !== "recovery" && command !== "health" && command !== "plan" && command !== "lockfile" && command !== "instance" && command !== "config-drift" && command !== "config-apply" && command !== "config-snapshot" && command !== "secrets" && command !== "backup" && command !== "diagnostics" && command !== "operator" && command !== "services") {
          throw new Error("--json is only supported for the install, start, setup, updates, recovery, health, plan, lockfile, instance, config-drift, config-apply, config-snapshot, secrets, backup, diagnostics, operator, and services commands.");
        }
        parsed.json = true;
        break;
      }
      case "--until": {
        if (command !== "operator" || parsed.operatorActionsAction !== "defer") {
          throw new Error("--until is only supported for operator actions defer.");
        }
        const value = remaining.shift();
        if (!value) {
          throw new Error("Missing value for --until.");
        }
        parsed.deferredUntil = value;
        break;
      }
      case "--dry-run": {
        if ((command !== "services" || parsed.serviceCommand !== "import") && command !== "diagnostics") {
          throw new Error("--dry-run is only supported for the services import and diagnostics bundle commands.");
        }
        parsed.dryRun = true;
        if (command === "diagnostics") {
          parsed.preview = true;
        }
        break;
      }
      case "--preview": {
        if (command !== "diagnostics") {
          throw new Error("--preview is only supported for the diagnostics bundle command.");
        }
        parsed.preview = true;
        break;
      }
      case "--tag": {
        if (command !== "services" || parsed.serviceCommand !== "import") {
          throw new Error("--tag is only supported for the services import command.");
        }
        const value = remaining.shift();
        if (!value) {
          throw new Error("Missing value for --tag.");
        }
        parsed.tag = value;
        break;
      }
      case "--api-base-url": {
        if (command !== "services" || parsed.serviceCommand !== "import") {
          throw new Error("--api-base-url is only supported for the services import command.");
        }
        const value = remaining.shift();
        if (!value) {
          throw new Error("Missing value for --api-base-url.");
        }
        parsed.apiBaseUrl = value;
        break;
      }
      case "--force": {
        if (!((command === "updates" && parsed.updateAction === "install") || (command === "setup" && parsed.setupAction === "run") || (command === "plan" && parsed.planAction === "update-install") || (command === "services" && parsed.serviceCommand === "import"))) {
          throw new Error("--force is only supported for updates install, setup run, plan update-install, and services import commands.");
        }
        parsed.force = true;
        break;
      }
      case "--include-manual": {
        if (command !== "setup" || parsed.setupAction !== "run") {
          throw new Error("--include-manual is only supported for the setup run command.");
        }
        parsed.includeManual = true;
        break;
      }
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return parsed;
}

function formatUpdateLine(service: { serviceId: string; update: ServiceUpdateState }): string {
  const update = service.update;
  const lastCheck = update.lastCheck;

  if (update.state === "downloadedCandidate" && update.downloadedCandidate) {
    return `${service.serviceId}: downloaded candidate ${update.downloadedCandidate.tag}`;
  }

  if (update.state === "installDeferred" && update.installDeferred) {
    return `${service.serviceId}: install deferred - ${update.installDeferred.reason}`;
  }

  if (update.state === "failed" && update.failed) {
    return `${service.serviceId}: update check failed - ${update.failed.reason}`;
  }

  if (update.state === "available" && update.available) {
    return `${service.serviceId}: update available ${lastCheck?.installedTag ?? lastCheck?.manifestTag ?? "unknown"} -> ${update.available.tag ?? "unknown"}`;
  }

  return `${service.serviceId}: latest installed`;
}

function printUpdatesResult(result: UpdatesCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === "list") {
    console.log("[service-lasso] update status");
    for (const service of result.services) {
      console.log(`- ${formatUpdateLine(service)}`);
    }
    return;
  }

  if (result.action === "check") {
    console.log("[service-lasso] update check completed");
    for (const service of result.services) {
      console.log(`- ${formatUpdateLine(service)}`);
    }
    return;
  }

  if (result.action === "download") {
    console.log("[service-lasso] update candidate downloaded");
    console.log(`- service: ${result.serviceId}`);
    console.log(`- candidate: ${result.update.downloadedCandidate?.tag ?? "unknown"}`);
    console.log(`- archivePath: ${result.archivePath}`);
    return;
  }

  console.log("[service-lasso] update candidate installed");
  console.log(`- service: ${result.serviceId}`);
  console.log(`- installedTag: ${result.state.installArtifacts.artifact?.tag ?? "unknown"}`);
  console.log(`- forced: ${result.forced}`);
  console.log(`- rollbackReadiness: ${result.rollbackReadiness.status}`);
}

function printPlanResult(result: RuntimePlanCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("[service-lasso] dry-run plan");
  console.log(`- action: ${result.action}`);
  console.log(`- ok: ${result.ok}`);
  console.log(`- servicesRoot: ${result.servicesRoot}`);
  for (const step of result.steps) {
    const reason = step.reason ? ` (${step.reason})` : "";
    console.log(`- ${step.order}. ${step.serviceId}: ${step.action} ${step.status}${reason}`);
    if (step.prerequisites.length > 0) {
      console.log(`  prerequisites: ${step.prerequisites.join("; ")}`);
    }
  }
}

function formatRecoveryLine(service: { serviceId: string; recovery: ServiceRecoveryHistoryState }): string {
  const lastEvent = service.recovery.events.at(-1);
  if (!lastEvent) {
    return `${service.serviceId}: no recovery events`;
  }

  if (lastEvent.kind === "monitor") {
    return `${service.serviceId}: ${service.recovery.events.length} events, last monitor ${lastEvent.action}/${lastEvent.reason}`;
  }

  if (lastEvent.kind === "hook") {
    return `${service.serviceId}: ${service.recovery.events.length} events, last hook ${lastEvent.phase} ok=${lastEvent.ok}`;
  }

  return `${service.serviceId}: ${service.recovery.events.length} events, last ${lastEvent.kind} ok=${lastEvent.ok}`;
}

function printRecoveryResult(result: RecoveryCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === "status") {
    console.log("[service-lasso] recovery status");
    for (const service of result.services) {
      console.log(`- ${formatRecoveryLine(service)}`);
    }
    return;
  }

  console.log("[service-lasso] doctor completed");
  console.log(`- service: ${result.serviceId}`);
  console.log(`- ok: ${result.doctor.ok}`);
  console.log(`- blocked: ${result.doctor.blocked}`);
  console.log(`- steps: ${result.doctor.steps.length}`);
}

function printHealthResult(result: HealthCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("[service-lasso] health history");
  for (const service of result.services) {
    const last = service.healthHistory.transitions.at(-1);
    if (!last) {
      console.log(`- ${service.serviceId}: no health transitions`);
      continue;
    }
    console.log(`- ${service.serviceId}: ${service.healthHistory.transitions.length} transitions, last ${last.status}/${last.checkType} at ${last.at}`);
  }
}

function printLockfileResult(result: LockfileCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === "generate") {
    console.log("[service-lasso] service lockfile generated");
    console.log("- lockfilePath: " + result.lockfilePath);
    console.log("- services: " + result.lockfile.services.length);
    return;
  }

  console.log(result.ok ? "[service-lasso] service lockfile verified" : "[service-lasso] service lockfile drift detected");
  console.log("- lockfilePath: " + result.lockfilePath);
  console.log("- checkedServices: " + result.checkedServices);
  for (const issue of result.issues) {
    console.log("- " + issue.serviceId + ": " + issue.status + " (" + issue.message + ")");
  }
}

function printConfigDriftResult(result: ConfigDriftCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("[service-lasso] config drift");
  for (const service of result.services) {
    console.log(`- ${service.serviceId}: ${service.summary.drifted} drifted / ${service.summary.total} files`);
    for (const file of service.files.filter((entry) => entry.status !== "unchanged")) {
      console.log(`  - ${file.path}: ${file.status}`);
    }
  }
}

function printConfigApplyResult(result: ConfigApplyCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("[service-lasso] config apply preflight");
  console.log("- ok: " + result.ok);
  console.log("- mutated: " + result.mutated);
  console.log(
    "- services: allowed=" +
      result.summary.allowed +
      " warning=" +
      result.summary.warning +
      " blocked=" +
      result.summary.blocked,
  );
  for (const service of result.services) {
    console.log("- " + service.serviceId + ": " + service.status);
    console.log("  restartRequired: " + service.restartRequirement.required);
    for (const gate of service.policyGates.filter((entry) => entry.status !== "allowed")) {
      console.log("  gate " + gate.gate + ": " + gate.status + " (" + gate.reason + ")");
    }
  }
}

function printConfigSnapshotResult(result: ConfigSnapshotCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === "export") {
    console.log("[service-lasso] config snapshot exported");
    console.log("- snapshotPath: " + result.snapshotPath);
    console.log("- services: " + result.snapshot.serviceCount);
    console.log("- policy: runtime/logs excluded, raw secrets redacted, import dry-run by default");
    return;
  }

  console.log("[service-lasso] config snapshot import dry-run");
  console.log("- snapshotPath: " + result.snapshotPath);
  console.log("- ok: " + result.ok);
  console.log("- mutated: " + result.mutated);
  for (const blocked of result.blocked) {
    console.log("- blocked: " + blocked);
  }
  for (const service of result.services) {
    console.log("- " + service.serviceId + ": " + service.action + " (" + service.reasons.join(", ") + ")");
  }
}

function printSecretsResult(result: SecretsCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("[service-lasso] secret reference audit");
  if ("services" in result) {
    console.log("- services: " + result.summary.services);
    console.log("- references: " + result.summary.references);
    console.log("- present: " + result.summary.present);
    console.log("- missing: " + result.summary.missing);
    console.log("- malformed: " + result.summary.malformed);
    for (const service of result.services) {
      console.log(
        "- " +
          service.serviceId +
          ": present=" +
          service.summary.present +
          " missing=" +
          service.summary.missing +
          " malformed=" +
          service.summary.malformed,
      );
    }
    return;
  }

  console.log("- service: " + result.serviceId);
  console.log("- present: " + result.summary.present);
  console.log("- missing: " + result.summary.missing);
  console.log("- malformed: " + result.summary.malformed);
  for (const finding of result.findings) {
    console.log("- " + finding.status + ": " + finding.ref + " (" + finding.location + ")");
  }
}

function printBackupResult(result: BackupCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === "create") {
    console.log("[service-lasso] workspace backup created");
    console.log("- archivePath: " + result.archivePath);
    console.log("- services: " + result.manifest.serviceCount);
    console.log("- policy: manifests/state redacted, log contents excluded");
    return;
  }

  console.log("[service-lasso] restore plan completed");
  console.log("- archivePath: " + result.archivePath);
  console.log("- ok: " + result.ok);
  console.log("- services: current=" + result.serviceCount.current + " backup=" + result.serviceCount.backup);
  console.log("- mutated: " + result.mutated);
  for (const blocked of result.blocked) {
    console.log("- blocked: " + blocked);
  }
  for (const service of result.services) {
    console.log("- " + service.serviceId + ": " + service.action + " (" + service.reasons.join(", ") + ")");
  }
}

function printDiagnosticsResult(result: DiagnosticsCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("[service-lasso] diagnostics bundle preview");
  console.log("- scope: " + result.scope.kind + (result.scope.serviceId ? " " + result.scope.serviceId : ""));
  console.log("- services: " + result.runtime.serviceCount);
  console.log("- wouldWriteBundle: " + result.output.wouldWriteBundle);
  console.log("- files: " + result.output.files.length);
  console.log("- redaction: " + result.redaction.value);
  for (const service of result.services) {
    console.log("- " + service.serviceId + ": files=" + service.files.length + " logSegments=" + service.logSegments.length);
    const envRedaction = service.redactions.find((entry) => entry.surface === "manifest.env");
    const globalenvRedaction = service.redactions.find((entry) => entry.surface === "manifest.globalenv");
    console.log("  envKeys: " + (envRedaction?.keys?.join(", ") || "none"));
    console.log("  globalenvKeys: " + (globalenvRedaction?.keys?.join(", ") || "none"));
  }
}

function printOperatorResult(result: OperatorCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("[service-lasso] operator action queue");
  console.log(`- action: ${result.actionsAction}`);
  console.log(`- items: ${result.queue.items.length}`);
  for (const item of result.queue.items) {
    console.log(`- ${item.id}: ${item.status} ${item.severity} ${item.title}`);
  }
}

function printSetupResult(result: SetupCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === "list") {
    console.log("[service-lasso] setup steps");
    for (const service of result.services ?? []) {
      console.log(`- ${service.serviceId}: ${service.steps.join(", ")}`);
    }
    return;
  }

  const setup = result.result;
  console.log("[service-lasso] setup completed");
  console.log(`- service: ${setup?.serviceId ?? "unknown"}`);
  console.log(`- ok: ${setup?.ok ?? false}`);
  for (const run of setup?.runs ?? []) {
    console.log(`- ${run.stepId}: ${run.status} (${run.exitCode ?? "no-exit-code"})`);
  }
  for (const skipped of setup?.skipped ?? []) {
    console.log(`- ${skipped.stepId}: skipped (${skipped.reason})`);
  }
}

function printBootstrapResult(
  result: BootstrapBaselineResult,
  app: Awaited<ReturnType<typeof startRuntimeApp>>,
  asJson: boolean,
): void {
  const payload = {
    servicesRoot: result.servicesRoot,
    workspaceRoot: result.workspaceRoot,
    apiUrl: app.apiServer.url,
    requestedServiceIds: result.requestedServiceIds,
    serviceOrder: result.serviceOrder,
    services: result.services,
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("[service-lasso] baseline start completed");
  console.log(`- api: ${app.apiServer.url}`);
  console.log(`- servicesRoot: ${result.servicesRoot}`);
  console.log(`- workspaceRoot: ${result.workspaceRoot}`);
  for (const service of result.services) {
    const actionSummary = service.actions
      .map((action) => `${action.action}:${action.status}`)
      .join(", ") || "no actions";
    console.log(`- ${service.serviceId}: ${service.status} (${actionSummary})`);
  }
}

function printInstallResult(result: Awaited<ReturnType<typeof installServiceFromCli>>, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("[service-lasso] install completed");
  console.log(`- service: ${result.serviceId}`);
  console.log(`- servicesRoot: ${result.servicesRoot}`);
  console.log(`- workspaceRoot: ${result.workspaceRoot}`);
  console.log(`- installed: ${result.state.installed}`);
  console.log(`- running: ${result.state.running}`);
  if (result.state.installArtifacts.artifact?.archivePath) {
    console.log(`- archivePath: ${result.state.installArtifacts.artifact.archivePath}`);
  }
  if (result.state.installArtifacts.artifact?.extractedPath) {
    console.log(`- extractedPath: ${result.state.installArtifacts.artifact.extractedPath}`);
  }
}

function printImportServiceResult(result: ImportServiceManifestCliResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.dryRun ? "[service-lasso] service import dry-run completed" : "[service-lasso] service manifest imported");
  console.log(`- repo: ${result.repo}`);
  console.log(`- tag: ${result.resolvedTag ?? result.requestedTag ?? "latest"}`);
  console.log(`- service: ${result.serviceId}`);
  console.log(`- servicesRoot: ${result.servicesRoot}`);
  console.log(`- targetPath: ${result.targetPath}`);
  console.log(`- wrote: ${result.wrote}`);
  console.log(`- overwritten: ${result.overwritten}`);
}

function printInstanceResult(result: RuntimeInstanceResponse, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("[service-lasso] runtime instance");
  if (!result.instance) {
    console.log("- current: not recorded");
  } else {
    console.log("- current: " + result.instance.instanceId);
    console.log("- status: " + result.instance.status);
    console.log("- api: " + result.instance.apiUrl);
    console.log("- servicesRoot: " + result.instance.servicesRoot);
    console.log("- workspaceRoot: " + result.instance.workspaceRoot);
  }
  console.log("- registry: " + result.registry.path);
  console.log("- active: " + result.registry.activeCount);
  console.log("- stale: " + result.registry.staleCount);
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(argv);
  const runtimeVersion = resolveRuntimeVersion();

  if (parsed.command === "help") {
    console.log(usageText());
    return;
  }

  if (parsed.command === "version") {
    console.log(runtimeVersion);
    return;
  }

  if (parsed.command === "install") {
    const result = await installServiceFromCli({
      serviceId: parsed.serviceId!,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printInstallResult(result, parsed.json);
    return;
  }

  if (parsed.command === "services" && parsed.serviceCommand === "import") {
    const result = await importServiceManifestFromCli({
      repo: parsed.repo!,
      tag: parsed.tag,
      servicesRoot: parsed.servicesRoot,
      apiBaseUrl: parsed.apiBaseUrl,
      force: parsed.force,
      dryRun: parsed.dryRun,
    });
    printImportServiceResult(result, parsed.json);
    return;
  }

  if (parsed.command === "setup") {
    const result = await runSetupCliAction({
      action: parsed.setupAction!,
      serviceId: parsed.serviceId,
      stepId: parsed.stepId,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
      force: parsed.force,
      includeManual: parsed.includeManual,
    });
    printSetupResult(result, parsed.json);
    return;
  }

  if (parsed.command === "updates") {
    const result = await runUpdatesCliAction({
      action: parsed.updateAction!,
      serviceId: parsed.serviceId,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
      force: parsed.force,
    });
    printUpdatesResult(result, parsed.json);
    return;
  }

  if (parsed.command === "plan") {
    const result = await runRuntimePlanCliAction({
      action: parsed.planAction!,
      serviceId: parsed.serviceId,
      manifestPath: parsed.manifestPath,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
      force: parsed.force,
    });
    printPlanResult(result, parsed.json);
    return;
  }

  if (parsed.command === "recovery") {
    const result = await runRecoveryCliAction({
      action: parsed.recoveryAction!,
      serviceId: parsed.serviceId,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printRecoveryResult(result, parsed.json);
    return;
  }

  if (parsed.command === "health") {
    const result = await runHealthCliAction({
      action: parsed.healthAction!,
      serviceId: parsed.serviceId,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printHealthResult(result, parsed.json);
    return;
  }

  if (parsed.command === "instance") {
    const result = await readRuntimeInstanceForCli({
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printInstanceResult(result, parsed.json);
    return;
  }

  if (parsed.command === "lockfile") {
    const result = await runLockfileCliAction({
      action: parsed.lockfileAction!,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printLockfileResult(result, parsed.json);
    if (result.action === "verify" && !result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.command === "config-drift") {
    const result = await runConfigDriftCliAction({
      serviceId: parsed.serviceId,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printConfigDriftResult(result, parsed.json);
    return;
  }

  if (parsed.command === "config-apply") {
    const result = await runConfigApplyCliAction({
      action: parsed.configApplyAction!,
      serviceId: parsed.serviceId,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printConfigApplyResult(result, parsed.json);
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.command === "config-snapshot") {
    const result = await runConfigSnapshotCliAction({
      action: parsed.configSnapshotAction!,
      serviceId: parsed.serviceId,
      snapshotPath: parsed.snapshotPath,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printConfigSnapshotResult(result, parsed.json);
    return;
  }

  if (parsed.command === "secrets") {
    const result = await runSecretsCliAction({
      action: parsed.secretsAction!,
      serviceId: parsed.serviceId,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printSecretsResult(result, parsed.json);
    return;
  }

  if (parsed.command === "backup") {
    const result = await runBackupCliAction({
      action: parsed.backupAction!,
      archivePath: parsed.archivePath,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printBackupResult(result, parsed.json);
    return;
  }

  if (parsed.command === "diagnostics") {
    const result = await runDiagnosticsCliAction({
      action: parsed.diagnosticsAction!,
      serviceId: parsed.serviceId,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
      preview: parsed.preview ?? false,
    });
    printDiagnosticsResult(result, parsed.json);
    return;
  }

  if (parsed.command === "operator") {
    const result = await runOperatorCliAction({
      action: "actions",
      actionsAction: parsed.operatorActionsAction!,
      itemId: parsed.actionId,
      deferredUntil: parsed.deferredUntil,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printOperatorResult(result, parsed.json);
    return;
  }

  if (parsed.command === "start") {
    const runtimePort = parsed.port ?? Number(process.env.SERVICE_LASSO_PORT ?? 18080);
    process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL = `http://127.0.0.1:${runtimePort}`;

    const bootstrap = await bootstrapBaselineServices({
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    const app = await startRuntimeApp({
      port: runtimePort,
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    printBootstrapResult(bootstrap, app, parsed.json);
    return;
  }

  const app = await startRuntimeApp({
    port: parsed.port ?? Number(process.env.SERVICE_LASSO_PORT ?? 18080),
    servicesRoot: parsed.servicesRoot,
    workspaceRoot: parsed.workspaceRoot,
    version: runtimeVersion,
  });

  console.log("[service-lasso] core API spine started");
  console.log(`- api: ${app.apiServer.url}`);
  console.log(`- servicesRoot: ${app.serviceRoot.servicesRoot}`);
  console.log(`- workspaceRoot: ${app.serviceRoot.workspaceRoot}`);
}

runCli().catch((error: unknown) => {
  console.error("[service-lasso] CLI failed");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
