import { startRuntimeApp } from "./runtime/app.js";
import { bootstrapBaselineServices, type BootstrapBaselineResult } from "./runtime/cli/bootstrap.js";
import { installServiceFromCli } from "./runtime/cli/install.js";
import { resolveRuntimeVersion } from "./runtime/version.js";

interface ParsedCliOptions {
  command: "serve" | "install" | "start" | "help" | "version";
  serviceId?: string;
  port?: number;
  servicesRoot?: string;
  workspaceRoot?: string;
  json: boolean;
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
    "  service-lasso help",
    "  service-lasso --version",
    "",
    "Notes:",
    "  - Running without a command starts the bounded core API runtime.",
    "  - The start command installs/configures/starts the baseline services, then leaves the API running.",
    "  - The install command acquires and installs a service from manifest-owned artifact metadata without starting it.",
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
    return { command: "serve", json: false };
  }

  if (commandToken === "help" || commandToken === "--help" || commandToken === "-h") {
    return { command: "help", json: false };
  }

  if (commandToken === "--version" || commandToken === "-v" || commandToken === "version") {
    return { command: "version", json: false };
  }

  const command = commandToken === "serve" || commandToken === "install" || commandToken === "start" ? commandToken : null;
  if (!command) {
    throw new Error(`Unknown command: ${commandToken}`);
  }

  remaining.shift();

  const parsed: ParsedCliOptions = {
    command,
    json: false,
  };

  if (command === "install") {
    const serviceId = remaining.shift();
    if (!serviceId || serviceId.startsWith("-")) {
      throw new Error('The "install" command requires a <serviceId> argument.');
    }
    parsed.serviceId = serviceId;
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
        if (command !== "install" && command !== "start") {
          throw new Error("--json is only supported for the install and start commands.");
        }
        parsed.json = true;
        break;
      }
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return parsed;
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
