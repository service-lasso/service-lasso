import type { ServiceLifecycleState } from "./types.js";

const lifecycleState = new Map<string, ServiceLifecycleState>();

function cloneBrokerIdentity(identity: ServiceLifecycleState["runtime"]["brokerIdentity"]): ServiceLifecycleState["runtime"]["brokerIdentity"] {
  if (!identity) {
    return null;
  }

  return {
    id: identity.id,
    serviceId: identity.serviceId,
    issuedAt: identity.issuedAt,
    expiresAt: identity.expiresAt,
    revokedAt: identity.revokedAt,
    transportBinding: identity.transportBinding
      ? { ...identity.transportBinding }
      : null,
    scope: {
      namespaces: [...identity.scope.namespaces],
      operations: [...identity.scope.operations],
      refs: [...identity.scope.refs],
    },
    audit: { ...identity.audit },
  };
}

function cloneStartTrace(trace: ServiceLifecycleState["runtime"]["startTrace"]): ServiceLifecycleState["runtime"]["startTrace"] {
  return {
    current: trace.current
      ? {
          ...trace.current,
          events: trace.current.events.map((event) => ({
            ...event,
            metadata: { ...event.metadata },
          })),
        }
      : null,
    history: trace.history.map((attempt) => ({
      ...attempt,
      events: attempt.events.map((event) => ({
        ...event,
        metadata: { ...event.metadata },
      })),
    })),
  };
}

function createInitialState(): ServiceLifecycleState {
  return {
    installed: false,
    configured: false,
    running: false,
    lastAction: null,
    actionHistory: [],
    installArtifacts: {
      files: [],
      updatedAt: null,
      artifact: {
        sourceType: null,
        repo: null,
        channel: null,
        tag: null,
        assetName: null,
        assetUrl: null,
        archiveType: null,
        archivePath: null,
        extractedPath: null,
      command: null,
      args: [],
      checksum: null,
    },
    },
    configArtifacts: {
      files: [],
      updatedAt: null,
    },
    setup: {
      updatedAt: null,
      steps: {},
    },
    runtime: {
      pid: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      command: null,
      provider: null,
      providerServiceId: null,
      lastTermination: null,
      ports: {},
      logs: {
        runId: null,
        logPath: null,
        stdoutPath: null,
        stderrPath: null,
      },
      metrics: {
        launchCount: 0,
        stopCount: 0,
        exitCount: 0,
        crashCount: 0,
        restartCount: 0,
        totalRunDurationMs: 0,
        lastRunDurationMs: null,
      },
      brokerIdentity: null,
      startTrace: {
        current: null,
        history: [],
      },
    },
  };
}

export function getLifecycleState(serviceId: string): ServiceLifecycleState {
  const current = lifecycleState.get(serviceId) ?? createInitialState();

  if (!lifecycleState.has(serviceId)) {
    lifecycleState.set(serviceId, current);
  }

  return {
    installed: current.installed,
    configured: current.configured,
    running: current.running,
    lastAction: current.lastAction,
    actionHistory: [...current.actionHistory],
    installArtifacts: {
      files: [...current.installArtifacts.files],
      updatedAt: current.installArtifacts.updatedAt,
      ...(current.installArtifacts.artifact
        ? {
            artifact: {
              sourceType: current.installArtifacts.artifact.sourceType,
              repo: current.installArtifacts.artifact.repo,
              channel: current.installArtifacts.artifact.channel,
              tag: current.installArtifacts.artifact.tag,
              assetName: current.installArtifacts.artifact.assetName,
              assetUrl: current.installArtifacts.artifact.assetUrl,
              archiveType: current.installArtifacts.artifact.archiveType,
              archivePath: current.installArtifacts.artifact.archivePath,
              extractedPath: current.installArtifacts.artifact.extractedPath,
              command: current.installArtifacts.artifact.command,
              args: [...current.installArtifacts.artifact.args],
              checksum: current.installArtifacts.artifact.checksum
                ? { ...current.installArtifacts.artifact.checksum }
                : null,
            },
          }
        : {}),
    },
    configArtifacts: {
      files: [...current.configArtifacts.files],
      updatedAt: current.configArtifacts.updatedAt,
    },
    setup: {
      updatedAt: current.setup.updatedAt,
      steps: Object.fromEntries(
        Object.entries(current.setup.steps).map(([stepId, step]) => [
          stepId,
          {
            status: step.status,
            lastRun: step.lastRun ? { ...step.lastRun, logs: { ...step.lastRun.logs } } : null,
            history: step.history.map((run) => ({ ...run, logs: { ...run.logs } })),
          },
        ]),
      ),
    },
    runtime: {
      pid: current.runtime.pid,
      startedAt: current.runtime.startedAt,
      finishedAt: current.runtime.finishedAt,
      exitCode: current.runtime.exitCode,
      command: current.runtime.command,
      provider: current.runtime.provider,
      providerServiceId: current.runtime.providerServiceId,
      lastTermination: current.runtime.lastTermination,
      ports: { ...current.runtime.ports },
      logs: {
        runId: current.runtime.logs.runId,
        logPath: current.runtime.logs.logPath,
        stdoutPath: current.runtime.logs.stdoutPath,
        stderrPath: current.runtime.logs.stderrPath,
      },
      metrics: {
        launchCount: current.runtime.metrics.launchCount,
        stopCount: current.runtime.metrics.stopCount,
        exitCount: current.runtime.metrics.exitCount,
        crashCount: current.runtime.metrics.crashCount,
        restartCount: current.runtime.metrics.restartCount,
        totalRunDurationMs: current.runtime.metrics.totalRunDurationMs,
        lastRunDurationMs: current.runtime.metrics.lastRunDurationMs,
      },
      brokerIdentity: cloneBrokerIdentity(current.runtime.brokerIdentity),
      startTrace: cloneStartTrace(current.runtime.startTrace),
    },
  };
}

export function setLifecycleState(serviceId: string, nextState: ServiceLifecycleState): ServiceLifecycleState {
  const cloned = {
    installed: nextState.installed,
    configured: nextState.configured,
    running: nextState.running,
    lastAction: nextState.lastAction,
    actionHistory: [...nextState.actionHistory],
    installArtifacts: {
      files: [...nextState.installArtifacts.files],
      updatedAt: nextState.installArtifacts.updatedAt,
      ...(nextState.installArtifacts.artifact
        ? {
            artifact: {
              sourceType: nextState.installArtifacts.artifact.sourceType,
              repo: nextState.installArtifacts.artifact.repo,
              channel: nextState.installArtifacts.artifact.channel,
              tag: nextState.installArtifacts.artifact.tag,
              assetName: nextState.installArtifacts.artifact.assetName,
              assetUrl: nextState.installArtifacts.artifact.assetUrl,
              archiveType: nextState.installArtifacts.artifact.archiveType,
              archivePath: nextState.installArtifacts.artifact.archivePath,
              extractedPath: nextState.installArtifacts.artifact.extractedPath,
              command: nextState.installArtifacts.artifact.command,
              args: [...nextState.installArtifacts.artifact.args],
              checksum: nextState.installArtifacts.artifact.checksum
                ? { ...nextState.installArtifacts.artifact.checksum }
                : null,
            },
          }
        : {}),
    },
    configArtifacts: {
      files: [...nextState.configArtifacts.files],
      updatedAt: nextState.configArtifacts.updatedAt,
    },
    setup: {
      updatedAt: nextState.setup.updatedAt,
      steps: Object.fromEntries(
        Object.entries(nextState.setup.steps).map(([stepId, step]) => [
          stepId,
          {
            status: step.status,
            lastRun: step.lastRun ? { ...step.lastRun, logs: { ...step.lastRun.logs } } : null,
            history: step.history.map((run) => ({ ...run, logs: { ...run.logs } })),
          },
        ]),
      ),
    },
    runtime: {
      pid: nextState.runtime.pid,
      startedAt: nextState.runtime.startedAt,
      finishedAt: nextState.runtime.finishedAt,
      exitCode: nextState.runtime.exitCode,
      command: nextState.runtime.command,
      provider: nextState.runtime.provider,
      providerServiceId: nextState.runtime.providerServiceId,
      lastTermination: nextState.runtime.lastTermination,
      ports: { ...nextState.runtime.ports },
      logs: {
        runId: nextState.runtime.logs.runId,
        logPath: nextState.runtime.logs.logPath,
        stdoutPath: nextState.runtime.logs.stdoutPath,
        stderrPath: nextState.runtime.logs.stderrPath,
      },
      metrics: {
        launchCount: nextState.runtime.metrics.launchCount,
        stopCount: nextState.runtime.metrics.stopCount,
        exitCount: nextState.runtime.metrics.exitCount,
        crashCount: nextState.runtime.metrics.crashCount,
        restartCount: nextState.runtime.metrics.restartCount,
        totalRunDurationMs: nextState.runtime.metrics.totalRunDurationMs,
        lastRunDurationMs: nextState.runtime.metrics.lastRunDurationMs,
      },
      brokerIdentity: cloneBrokerIdentity(nextState.runtime.brokerIdentity),
      startTrace: cloneStartTrace(nextState.runtime.startTrace),
    },
  };

  lifecycleState.set(serviceId, cloned);
  return getLifecycleState(serviceId);
}

export function resetLifecycleState(): void {
  lifecycleState.clear();
}
