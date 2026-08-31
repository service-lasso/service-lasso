import type { DiscoveredService } from "../../contracts/service.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import {
  classifyRegisteredProcess,
  readProcessOwnershipRegistry,
  type ProcessOwnershipEntry,
  type ProcessOwnershipRegistry,
} from "../process/registry.js";
import { captureOwnedProcessTreeMembers } from "../process/tree.js";
import {
  inspectTcpListenerProcesses,
  type TcpListenerProcessInspection,
} from "../process/listener.js";
import { resolveServiceText } from "../operator/variables.js";
import type { ServiceHealthcheck } from "./types.js";

export type ReadinessAttributionClassification =
  | "not_applicable"
  | "owned_listener"
  | "wrong_process_listener"
  | "wrong_generation_listener"
  | "listener_disappeared"
  | "listener_owner_unverifiable"
  | "ownership_evidence_mismatch";

export interface ReadinessAttributionEvidence {
  classification: ReadinessAttributionClassification;
  checkedEndpointCount: number;
}

export interface ReadinessAttributionResult {
  ready: boolean;
  evidence: ReadinessAttributionEvidence;
  message: string;
}

export interface ReadinessAttributionDependencies {
  readRegistry?: (workspaceRoot: string) => Promise<ProcessOwnershipRegistry>;
  classifyOwner?: (entry: ProcessOwnershipEntry) => Promise<"owned" | "not_running" | "identity_mismatch" | "unknown_owner">;
  captureMembers?: (entry: ProcessOwnershipEntry) => Promise<Array<{ pid: number }>>;
  inspectListener?: (host: string, port: number) => Promise<TcpListenerProcessInspection>;
}

export interface ReadinessAttributionOptions {
  workspaceRoot?: string;
  generationId?: string | null;
  allocationRevision?: string | null;
  expectedPorts?: Record<string, number>;
  dependencies?: ReadinessAttributionDependencies;
}

interface TcpTarget {
  host: string;
  port: number;
}

interface GovernedTargetResolution {
  targets: TcpTarget[];
  outsideAllocation: boolean;
}

function parseTcpAddress(value: string): TcpTarget | null {
  const address = value.trim();
  if (address.startsWith("[")) {
    const close = address.indexOf("]");
    if (close <= 1 || address[close + 1] !== ":") return null;
    const port = Number(address.slice(close + 2));
    return Number.isInteger(port) ? { host: address.slice(1, close), port } : null;
  }
  const separator = address.lastIndexOf(":");
  if (separator <= 0) return null;
  const port = Number(address.slice(separator + 1));
  return Number.isInteger(port) ? { host: address.slice(0, separator), port } : null;
}

function resolveNetworkTarget(
  healthcheck: ServiceHealthcheck,
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
  sharedGlobalEnv: Record<string, string>,
): TcpTarget | null {
  const allocated = lifecycle.runtime.ports;
  const declared = service.manifest.ports ?? {};
  // Stopped services keep declared manifest ports so probes target the operator-authored bind.
  const resolvedPorts = lifecycle.running && Object.keys(allocated).length > 0
    ? allocated
    : { ...allocated, ...declared };
  if (healthcheck.type === "http") {
    try {
      const target = new URL(resolveServiceText(healthcheck.url, service, sharedGlobalEnv, resolvedPorts));
      const port = target.port ? Number(target.port) : target.protocol === "https:" ? 443 : 80;
      return Number.isInteger(port) ? { host: target.hostname, port } : null;
    } catch {
      return null;
    }
  }
  if (healthcheck.type !== "tcp") return null;
  if (healthcheck.address !== undefined) {
    return parseTcpAddress(resolveServiceText(healthcheck.address, service, sharedGlobalEnv, resolvedPorts));
  }
  if (healthcheck.host !== undefined && healthcheck.port !== undefined) {
    const port = Number(resolveServiceText(String(healthcheck.port), service, sharedGlobalEnv, resolvedPorts));
    return Number.isInteger(port)
      ? { host: resolveServiceText(healthcheck.host, service, sharedGlobalEnv, resolvedPorts), port }
      : null;
  }
  const ports = [...new Set(Object.values(resolvedPorts))];
  return ports.length === 1 ? { host: "127.0.0.1", port: ports[0] } : null;
}

function governedTargets(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
  sharedGlobalEnv: Record<string, string>,
  expectedPorts: Record<string, number>,
): GovernedTargetResolution {
  const checks = service.manifest.healthchecks?.filter((check) => check.required !== false) ??
    (service.manifest.healthcheck ? [service.manifest.healthcheck] : []);
  const governedPorts = new Set(Object.values(expectedPorts));
  let outsideAllocation = false;
  const targets = checks.flatMap((check) => {
    const target = resolveNetworkTarget(check, service, lifecycle, sharedGlobalEnv);
    if (!target) return [];
    if (!governedPorts.has(target.port)) {
      outsideAllocation = true;
      return [];
    }
    return [target];
  });
  const seen = new Set<string>();
  return {
    outsideAllocation,
    targets: targets.filter((target) => {
      const key = `${target.host.toLowerCase()}\0${target.port}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

function result(
  ready: boolean,
  classification: ReadinessAttributionClassification,
  checkedEndpointCount: number,
): ReadinessAttributionResult {
  const messages: Record<ReadinessAttributionClassification, string> = {
    not_applicable: "Readiness listener attribution was not required.",
    owned_listener: "Readiness listener belongs to the transaction-owned service process tree.",
    wrong_process_listener: "Readiness failed (wrong_process_listener): expected endpoint is served by a different process.",
    wrong_generation_listener: "Readiness failed (wrong_generation_listener): expected endpoint is served by a different runtime generation.",
    listener_disappeared: "Readiness failed (listener_disappeared): endpoint listener disappeared before ownership attribution.",
    listener_owner_unverifiable: "Readiness failed (listener_owner_unverifiable): endpoint listener ownership could not be verified.",
    ownership_evidence_mismatch: "Readiness failed (ownership_evidence_mismatch): persisted service ownership does not match the startup transaction.",
  };
  return {
    ready,
    evidence: { classification, checkedEndpointCount },
    message: messages[classification],
  };
}

async function defaultCaptureMembers(entry: ProcessOwnershipEntry): Promise<Array<{ pid: number }>> {
  if (!entry.pid || !entry.identity) throw new Error("Process ownership identity is unavailable.");
  return await captureOwnedProcessTreeMembers({
    rootPid: entry.pid,
    rootIdentity: entry.identity,
    processGroup: entry.processGroup,
  });
}

export async function attributeServiceReadiness(
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
  sharedGlobalEnv: Record<string, string>,
  options: ReadinessAttributionOptions,
): Promise<ReadinessAttributionResult> {
  const workspaceRoot = options.workspaceRoot;
  const generationId = options.generationId;
  const allocationRevision = options.allocationRevision;
  const expectedPorts = options.expectedPorts ?? {};
  if (!workspaceRoot || !generationId || !allocationRevision || Object.keys(expectedPorts).length === 0) {
    return result(true, "not_applicable", 0);
  }
  const targetResolution = governedTargets(service, lifecycle, sharedGlobalEnv, expectedPorts);
  if (targetResolution.outsideAllocation) return result(false, "ownership_evidence_mismatch", 0);
  const targets = targetResolution.targets;
  if (targets.length === 0) return result(true, "not_applicable", 0);

  const dependencies = options.dependencies ?? {};
  const registry = await (dependencies.readRegistry ?? readProcessOwnershipRegistry)(workspaceRoot);
  const expectedOwner = registry.entries.find((entry) => entry.ownerType === "service" && entry.ownerId === service.manifest.id);
  if (
    !expectedOwner || expectedOwner.generationId !== generationId ||
    expectedOwner.allocation.revision !== allocationRevision || expectedOwner.pid === null || expectedOwner.identity === null
  ) {
    return result(false, "ownership_evidence_mismatch", 0);
  }
  const classifyOwner = dependencies.classifyOwner ?? classifyRegisteredProcess;
  if (await classifyOwner(expectedOwner) !== "owned") {
    return result(false, "ownership_evidence_mismatch", 0);
  }

  let members: Array<{ pid: number }>;
  try {
    members = await (dependencies.captureMembers ?? defaultCaptureMembers)(expectedOwner);
  } catch {
    return result(false, "listener_owner_unverifiable", 0);
  }
  const ownedPids = new Set(members.map((member) => member.pid));
  if (expectedOwner.pid) ownedPids.add(expectedOwner.pid);
  const inspectListener = dependencies.inspectListener ?? inspectTcpListenerProcesses;

  let checked = 0;
  for (const target of targets) {
    const inspection = await inspectListener(target.host, target.port);
    checked += 1;
    if (inspection.status === "not_listening") return result(false, "listener_disappeared", checked);
    if (inspection.status === "unknown") return result(false, "listener_owner_unverifiable", checked);
    const unmatchedPids = inspection.pids.filter((pid) => !ownedPids.has(pid));
    if (unmatchedPids.length === 0) continue;

    for (const entry of registry.entries) {
      if (!entry.pid || entry.generationId === generationId || await classifyOwner(entry) !== "owned") continue;
      if (unmatchedPids.includes(entry.pid)) return result(false, "wrong_generation_listener", checked);
      try {
        const otherMembers = await (dependencies.captureMembers ?? defaultCaptureMembers)(entry);
        if (otherMembers.some((member) => unmatchedPids.includes(member.pid))) {
          return result(false, "wrong_generation_listener", checked);
        }
      } catch {
        // A different owner's unverifiable tree cannot prove generation attribution.
      }
    }
    return result(false, "wrong_process_listener", checked);
  }
  return result(true, "owned_listener", checked);
}
