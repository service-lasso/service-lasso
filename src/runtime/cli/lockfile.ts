import { discoverServices } from "../discovery/discoverServices.js";
import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import {
  generateServiceLockfile,
  readServiceLockfile,
  resolveServiceLockfilePath,
  verifyServiceLockfile,
  writeServiceLockfile,
  type ServiceLockfile,
  type ServiceLockfileVerificationResult,
} from "../lockfile/service-lockfile.js";

export type LockfileCliAction = "generate" | "verify";

export interface LockfileCliOptions extends RuntimeConfigOptions {
  action: LockfileCliAction;
}

export type LockfileCliResult =
  | {
      action: "generate";
      servicesRoot: string;
      workspaceRoot: string;
      lockfilePath: string;
      lockfile: ServiceLockfile;
    }
  | (ServiceLockfileVerificationResult & {
      action: "verify";
      servicesRoot: string;
      workspaceRoot: string;
    });

export async function runLockfileCliAction(options: LockfileCliOptions): Promise<LockfileCliResult> {
  const runtimeConfig = await ensureRuntimeConfig(
    resolveRuntimeConfig({
      servicesRoot: options.servicesRoot,
      workspaceRoot: options.workspaceRoot,
      version: options.version,
    }),
  );
  const services = await discoverServices(runtimeConfig.servicesRoot);

  if (options.action === "generate") {
    const lockfile = generateServiceLockfile(services);
    const lockfilePath = await writeServiceLockfile(runtimeConfig.servicesRoot, lockfile);
    return {
      action: "generate",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      lockfilePath,
      lockfile,
    };
  }

  const existing = await readServiceLockfile(runtimeConfig.servicesRoot);
  const lockfile = existing ?? {
    lockfileVersion: 1,
    generatedBy: "service-lasso" as const,
    generatedAt: new Date(0).toISOString(),
    services: [],
  };
  const result = verifyServiceLockfile(runtimeConfig.servicesRoot, services, lockfile);
  return {
    action: "verify",
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    ...result,
    lockfilePath: existing ? result.lockfilePath : resolveServiceLockfilePath(runtimeConfig.servicesRoot),
  };
}
