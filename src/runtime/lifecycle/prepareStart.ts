import type { DiscoveredService } from "../../contracts/service.js";
import { LifecycleStateError } from "../../server/errors.js";
import { hasManagedProcess } from "../execution/supervisor.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { DependencyGraph } from "../manager/DependencyGraph.js";
import { isProviderRole } from "../roles.js";
import { listSetupStepIds, runServiceSetup, type SetupTransactionHooks } from "../setup/steps.js";
import { writeServiceState } from "../state/writeState.js";
import { configService, installService, startService, type ServiceLifecycleActionOptions } from "./actions.js";
import { getLifecycleState } from "./store.js";
import type { LifecycleActionResult, ServiceLifecycleState } from "./types.js";
import type {
  MaterializationWriteHooks,
  StartupArtifactAcquisitionHooks,
  StartupMaterializationKind,
} from "../startup/materialization.js";
import {
  buildServiceExecutableMutationRevision,
  buildServiceMutationDefinitionRevision,
  type ExecutableInputFileDigest,
} from "../setup/definition-revision.js";
import { collectRuntimeGlobalEnv } from "../operator/variables.js";

export type PreparedStartSkipReason = "already_running" | "provider_role" | "not_startable";

export interface PreparedStartResult {
  result: LifecycleActionResult | null;
  skippedReason: PreparedStartSkipReason | null;
  state: ServiceLifecycleState;
}

function hasStartableCommand(service: DiscoveredService, state: ServiceLifecycleState): boolean {
  return Boolean(service.manifest.execservice || service.manifest.executable || state.installArtifacts.artifact?.command);
}

async function persistResult(service: DiscoveredService, result: Pick<LifecycleActionResult, "state">): Promise<void> {
  await writeServiceState(service, result.state);
}

async function prepareServicePrerequisites(
  service: DiscoveredService,
  registry: ServiceRegistry,
  options: PreparedStartOptions,
): Promise<ServiceLifecycleState> {
  let state = getLifecycleState(service.manifest.id);

  if (!state.installed) {
    const result = await installService(service, registry, {
      ...serviceActionOptions(service.manifest.id, options),
      materializationHooks: options.materializationHooksFor?.(service, "install"),
      artifactAcquisitionHooks: options.artifactAcquisitionHooksFor?.(service),
    });
    await persistResult(service, result);
    state = result.state;
  }

  if (!state.configured) {
    const result = await configService(service, registry, {
      ...serviceActionOptions(service.manifest.id, options),
      materializationHooks: options.materializationHooksFor?.(service, "config"),
    });
    await persistResult(service, result);
    state = result.state;
  }

  if (listSetupStepIds(service).length > 0) {
    const result = await runServiceSetup(service, registry, {
      transactionHooks: options.setupTransactionHooks,
      lifecycleOptions: serviceActionOptions(service.manifest.id, options),
    });
    await writeServiceState(service, result.state);
    state = result.state;

    if (!result.ok) {
      throw new LifecycleStateError(result.message);
    }
  }

  return state;
}

export interface PreparedStartOptions extends Pick<
  ServiceLifecycleActionOptions,
  "workspaceRoot" | "runtimeGenerationId" | "runtimeInstanceId" | "allocationRevision"
> {
  plannedPortsByService?: Record<string, Record<string, number>>;
  allowedMutationServiceIds?: ReadonlySet<string>;
  expectedArtifactRevisionsByService?: Readonly<Record<string, string>>;
  expectedDefinitionRevisionsByService?: Readonly<Record<string, string>>;
  expectedTemplateDigestsByService?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  expectedExecutableRevisionsByService?: Readonly<Record<string, string>>;
  expectedExecutableFilesByService?: Readonly<Record<string, readonly ExecutableInputFileDigest[]>>;
  materializationHooksFor?: (
    service: DiscoveredService,
    kind: StartupMaterializationKind,
  ) => MaterializationWriteHooks;
  artifactAcquisitionHooksFor?: (service: DiscoveredService) => StartupArtifactAcquisitionHooks;
  setupTransactionHooks?: SetupTransactionHooks;
  onServiceStarting?: (service: DiscoveredService) => Promise<void>;
  onServiceStarted?: (service: DiscoveredService, result: LifecycleActionResult) => Promise<void>;
}

function serviceActionOptions(serviceId: string, options: PreparedStartOptions): ServiceLifecycleActionOptions {
  return {
    workspaceRoot: options.workspaceRoot,
    runtimeGenerationId: options.runtimeGenerationId,
    runtimeInstanceId: options.runtimeInstanceId,
    allocationRevision: options.allocationRevision,
    plannedPorts: options.plannedPortsByService?.[serviceId],
    plannedPortsByService: options.plannedPortsByService,
    expectedArtifactRevision: options.expectedArtifactRevisionsByService?.[serviceId],
    allowedMutationServiceIds: options.allowedMutationServiceIds,
    expectedDefinitionRevision: options.expectedDefinitionRevisionsByService?.[serviceId],
    expectedTemplateDigests: options.expectedTemplateDigestsByService?.[serviceId],
    expectedExecutableRevision: options.expectedExecutableRevisionsByService?.[serviceId],
    expectedExecutableFiles: options.expectedExecutableFilesByService?.[serviceId],
  };
}

export async function prepareAndStartService(
  service: DiscoveredService,
  registry: ServiceRegistry,
  options: PreparedStartOptions = {},
): Promise<PreparedStartResult> {
  const serviceId = service.manifest.id;
  const graph = new DependencyGraph(registry);
  const expectedDefinitionRevision = options.expectedDefinitionRevisionsByService?.[serviceId];
  if (
    expectedDefinitionRevision &&
    await buildServiceMutationDefinitionRevision(service) !== expectedDefinitionRevision
  ) {
    throw new LifecycleStateError(
      `Cannot mutate service "${serviceId}" because its manifest-owned execution definition changed after guarded preflight.`,
    );
  }
  const initialState = getLifecycleState(serviceId);

  if (initialState.running || hasManagedProcess(serviceId)) {
    return { result: null, skippedReason: "already_running", state: initialState };
  }
  if (options.allowedMutationServiceIds && !options.allowedMutationServiceIds.has(serviceId)) {
    throw new LifecycleStateError(
      `Cannot mutate service "${serviceId}" because it was not part of the approved lifecycle plan.`,
    );
  }

  for (const dependencyId of graph.getStartupOrder(serviceId)) {
    const dependency = registry.getById(dependencyId);
    if (!dependency) {
      throw new LifecycleStateError(
        `Cannot start service "${serviceId}" because dependency "${dependencyId}" was not found.`,
      );
    }

    await prepareAndStartService(dependency, registry, options);
  }

  let state = await prepareServicePrerequisites(service, registry, options);

  if (isProviderRole(service.manifest)) {
    return { result: null, skippedReason: "provider_role", state };
  }

  if (!hasStartableCommand(service, state)) {
    return { result: null, skippedReason: "not_startable", state };
  }

  await options.onServiceStarting?.(service);
  const actionOptions = serviceActionOptions(serviceId, options);
  if (options.allowedMutationServiceIds && !actionOptions.expectedExecutableRevision) {
    actionOptions.expectedExecutableRevision = await buildServiceExecutableMutationRevision(
      service,
      registry,
      actionOptions.plannedPorts,
      collectRuntimeGlobalEnv(registry.list()),
    );
  }
  const result = await startService(service, registry, actionOptions);
  await writeServiceState(service, result.state);
  state = result.state;

  if (result.ok && result.state.running) {
    await options.onServiceStarted?.(service, result);
  }

  return { result, skippedReason: null, state };
}
