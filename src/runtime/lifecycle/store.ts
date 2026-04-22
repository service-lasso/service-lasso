import type { ServiceLifecycleState } from "./types.js";

const lifecycleState = new Map<string, ServiceLifecycleState>();

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
      },
    },
    configArtifacts: {
      files: [],
      updatedAt: null,
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
            },
          }
        : {}),
    },
    configArtifacts: {
      files: [...current.configArtifacts.files],
      updatedAt: current.configArtifacts.updatedAt,
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
            },
          }
        : {}),
    },
    configArtifacts: {
      files: [...nextState.configArtifacts.files],
      updatedAt: nextState.configArtifacts.updatedAt,
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
    },
  };

  lifecycleState.set(serviceId, cloned);
  return getLifecycleState(serviceId);
}

export function resetLifecycleState(): void {
  lifecycleState.clear();
}
