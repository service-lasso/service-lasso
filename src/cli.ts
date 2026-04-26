import { startRuntimeApp } from "./runtime/app.js";
import { bootstrapBaselineServices, type BootstrapBaselineResult } from "./runtime/cli/bootstrap.js";
import { installServiceFromCli } from "./runtime/cli/install.js";
import { runUpdatesCliAction, type UpdateCliAction, type UpdatesCliResult } from "./runtime/cli/updates.js";
import type { ServiceUpdateState } from "./runtime/updates/state.js";
import { resolveRuntimeVersion } from "./runtime/version.js";

interface ParsedCliOptions {
  command: "serve" | "install" | "start" | "updates" | "help" | "version";
  updateAction?: UpdateCliAction;
  serviceId?: string;
  port?: number;
  servicesRoot?: string;
  workspaceRoot?: string;
  json: boolean;
  force: boolean;
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
    "  service-lasso updates list [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso updates check [serviceId] [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso updates download <serviceId> [--services-root <path>] [--workspace-root <path>] [--json]",
    "  service-lasso updates install <serviceId> [--services-root <path>] [--workspace-root <path>] [--force] [--json]",
    "  service-lasso help",
    "  service-lasso --version",
    "",
    "Notes:",
    "  - Running without a command starts the bounded core API runtime.",
    "  - The start command installs/configures/starts the baseline services, then leaves the API running.",
    "  - The install command acquires and installs a service from manifest-owned artifact metadata without starting it.",
    "  - The updates command checks, lists, downloads, or installs service update candidates.",
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
    return { command: "serve", json: false, force: false };
  }

  if (commandToken === "help" || commandToken === "--help" || commandToken === "-h") {
    return { command: "help", json: false, force: false };
  }

  if (commandToken === "--version" || commandToken === "-v" || commandToken === "version") {
    return { command: "version", json: false, force: false };
  }

  const command =
    commandToken === "serve" || commandToken === "install" || commandToken === "start" || commandToken === "updates"
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
        if (command !== "install" && command !== "start" && command !== "updates") {
          throw new Error("--json is only supported for the install, start, and updates commands.");
        }
        parsed.json = true;
        break;
      }
      case "--force": {
        if (command !== "updates" || parsed.updateAction !== "install") {
          throw new Error("--force is only supported for the updates install command.");
        }
        parsed.force = true;
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

  if (parsed.command === "start") {
    const bootstrap = await bootstrapBaselineServices({
      servicesRoot: parsed.servicesRoot,
      workspaceRoot: parsed.workspaceRoot,
      version: runtimeVersion,
    });
    const app = await startRuntimeApp({
      port: parsed.port ?? Number(process.env.SERVICE_LASSO_PORT ?? 18080),
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
