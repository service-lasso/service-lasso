import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ServiceFileExportArchiveResponse } from "../../contracts/api.js";
import type { DiscoveredService } from "../../contracts/service.js";
import { ApiError } from "../../server/errors.js";
import { runServiceAction } from "../actions/runs.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { buildServiceWorkspaceRegistry, type ServiceWorkspaceRegistryEntry } from "./workspace-registry.js";

const archiveProviderServiceId = "@archive";
const archiveProviderActionId = "archive-selection";
const artifactContractVersion = "service-lasso.file-export-artifact.v1";

export interface ArchiveSelectionExportRequest {
  actor?: string;
  source: {
    type: "file-selection";
    sourceId: string;
    serviceId: string;
    paths: string[];
    archiveFormat?: "7z";
    include?: string[];
    exclude?: string[];
  };
  archiveFormat?: "7z";
}

interface ResolvedSelection {
  workspace: ServiceWorkspaceRegistryEntry;
  selectedPaths: string[];
  resolvedPaths: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError("invalid_body", 400, `"${field}" must be a non-empty string.`);
  }
  return value.trim();
}

function optionalStringArray(record: Record<string, unknown>, field: string): string[] | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new ApiError("invalid_body", 400, `"${field}" must be an array of non-empty strings when present.`);
  }
  return value.map((entry) => entry.trim());
}

export function parseArchiveSelectionExportRequest(input: unknown): ArchiveSelectionExportRequest {
  if (!isRecord(input)) {
    throw new ApiError("invalid_body", 400, "Archive export body must be a JSON object.");
  }

  if (!isRecord(input.source)) {
    throw new ApiError("invalid_body", 400, "\"source\" must be a JSON object.");
  }
  if (input.source.type !== "file-selection") {
    throw new ApiError("invalid_body", 400, "\"source.type\" must be \"file-selection\".");
  }

  const source = input.source;
  const archiveFormat = input.archiveFormat ?? source.archiveFormat ?? "7z";
  if (archiveFormat !== "7z") {
    throw new ApiError("unsupported_archive_format", 400, "Only archiveFormat \"7z\" is supported.");
  }

  const paths = optionalStringArray(source, "paths");
  if (!paths || paths.length === 0) {
    throw new ApiError("invalid_body", 400, "\"source.paths\" must contain at least one selected path.");
  }

  return {
    actor: typeof input.actor === "string" && input.actor.trim().length > 0 ? input.actor.trim() : undefined,
    archiveFormat,
    source: {
      type: "file-selection",
      serviceId: stringField(source, "serviceId"),
      sourceId: stringField(source, "sourceId"),
      paths,
      archiveFormat,
      include: optionalStringArray(source, "include"),
      exclude: optionalStringArray(source, "exclude"),
    },
  };
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeSelectedPath(value: string): string {
  const portable = value.trim().replace(/\\/g, "/");
  if (path.isAbsolute(value) || /^[A-Za-z]:\//.test(portable)) {
    throw new ApiError("path_outside_workspace", 400, "Selected paths must be relative to the registered file source.");
  }

  const segments = portable.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new ApiError("path_outside_workspace", 400, "Selected paths must not traverse outside the registered file source.");
  }

  return segments.length > 0 ? segments.join("/") : ".";
}

function assertInsideBoundary(rootPath: string, selectedPath: string): void {
  const relative = path.relative(rootPath, selectedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError("path_outside_workspace", 400, "Selected paths must stay inside the registered file source.");
  }
}

async function resolveSelection(services: DiscoveredService[], request: ArchiveSelectionExportRequest): Promise<ResolvedSelection> {
  const registry = buildServiceWorkspaceRegistry(services);
  const workspace = registry.workspaces.find(
    (entry) =>
      entry.serviceId === request.source.serviceId &&
      (entry.id === request.source.sourceId || entry.rootId === request.source.sourceId),
  );
  if (!workspace) {
    throw new ApiError("unknown_file_source", 404, "The selected file source is not registered for that service.");
  }

  const rootPath = path.resolve(workspace.resolvedPath);
  const selectedPaths = request.source.paths.map(normalizeSelectedPath);
  const resolvedPaths = selectedPaths.map((selectedPath) => path.resolve(rootPath, selectedPath));
  for (const resolvedPath of resolvedPaths) {
    assertInsideBoundary(rootPath, resolvedPath);
    try {
      await stat(resolvedPath);
    } catch (error: unknown) {
      if (isRecord(error) && error.code === "ENOENT") {
        throw new ApiError("selected_path_not_found", 404, "A selected path was not found inside the registered file source.");
      }
      throw error;
    }
  }

  return { workspace, selectedPaths, resolvedPaths };
}

function getExportRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".service-lasso", "file-exports");
}

function getArtifactPath(workspaceRoot: string, artifactId: string, archiveFormat: "7z"): string {
  return path.join(getExportRoot(workspaceRoot), "artifacts", `${artifactId}.${archiveFormat}`);
}

function getMetadataPath(workspaceRoot: string, artifactId: string): string {
  return path.join(getExportRoot(workspaceRoot), `${artifactId}.json`);
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export async function readArchiveExportArtifact(
  workspaceRoot: string,
  artifactId: string,
): Promise<{ metadata: ServiceFileExportArchiveResponse["export"]; bytes: Buffer }> {
  if (!/^[A-Za-z0-9_.-]+$/.test(artifactId)) {
    throw new ApiError("invalid_artifact_id", 400, "Artifact id may only contain letters, numbers, dot, dash, and underscore.");
  }

  const parsed = JSON.parse(await readFile(getMetadataPath(workspaceRoot, artifactId), "utf8")) as ServiceFileExportArchiveResponse["export"];
  const artifactPath = getArtifactPath(workspaceRoot, artifactId, parsed.artifact.format);
  return {
    metadata: parsed,
    bytes: await readFile(artifactPath),
  };
}

export async function createArchiveSelectionExport(input: {
  services: DiscoveredService[];
  registry: ServiceRegistry;
  workspaceRoot: string;
  request: ArchiveSelectionExportRequest;
}): Promise<ServiceFileExportArchiveResponse> {
  const selection = await resolveSelection(input.services, input.request);
  const sourceService = input.registry.getById(input.request.source.serviceId);
  if (!sourceService) {
    throw new ApiError("unknown_service", 404, `Unknown service "${input.request.source.serviceId}".`);
  }

  const provider = input.registry.getById(archiveProviderServiceId);
  if (!provider || provider.manifest.enabled === false) {
    throw new ApiError("archive_provider_unavailable", 409, "Archive-backed file export requires the @archive provider to be available.");
  }
  if (!provider.manifest.actions?.[archiveProviderActionId]) {
    throw new ApiError(
      "archive_provider_action_unavailable",
      409,
      "Archive-backed file export requires @archive to expose the archive-selection action.",
    );
  }

  const createdAt = new Date().toISOString();
  const artifactId = `file-export-${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}`;
  const artifactPath = getArtifactPath(input.workspaceRoot, artifactId, input.request.archiveFormat ?? "7z");
  await mkdir(path.dirname(artifactPath), { recursive: true });

  const actionRun = await runServiceAction(provider, input.registry, archiveProviderActionId, {
    source: "manual",
    actor: input.request.actor,
    payload: {
      contractVersion: "service-lasso.file-export-request.v1",
      serviceId: sourceService.manifest.id,
      sourceId: selection.workspace.id,
      rootId: selection.workspace.rootId,
      selectedPaths: selection.selectedPaths,
      resolvedPaths: selection.resolvedPaths,
      include: input.request.source.include ?? [],
      exclude: input.request.source.exclude ?? [],
      archiveFormat: input.request.archiveFormat ?? "7z",
      artifact: {
        id: artifactId,
        path: artifactPath,
        format: input.request.archiveFormat ?? "7z",
      },
    },
  });

  if (!actionRun.ok) {
    throw new ApiError("archive_provider_failed", 502, actionRun.message);
  }

  const artifactStats = await stat(artifactPath).catch((error: unknown) => {
    if (isRecord(error) && error.code === "ENOENT") {
      throw new ApiError("archive_artifact_missing", 502, "The @archive provider completed without producing the expected artifact.");
    }
    throw error;
  });
  const checksum = await sha256File(artifactPath);
  const fileName = path.basename(artifactPath);
  const exportMetadata: ServiceFileExportArchiveResponse["export"] = {
    contractVersion: artifactContractVersion,
    artifactId,
    createdAt,
    serviceId: sourceService.manifest.id,
    sourceId: selection.workspace.id,
    rootId: selection.workspace.rootId,
    selectedPaths: selection.selectedPaths,
    archiveFormat: input.request.archiveFormat ?? "7z",
    provider: {
      serviceId: archiveProviderServiceId,
      actionId: archiveProviderActionId,
      version: provider.manifest.version ?? null,
      runId: actionRun.run.runId,
      status: "succeeded",
    },
    artifact: {
      id: artifactId,
      fileName,
      format: input.request.archiveFormat ?? "7z",
      sizeBytes: artifactStats.size,
      checksum: {
        algorithm: "sha256",
        value: checksum,
      },
      downloadUrl: `/api/files/exports/${encodeURIComponent(artifactId)}/download`,
    },
  };

  await mkdir(getExportRoot(input.workspaceRoot), { recursive: true });
  await writeFile(getMetadataPath(input.workspaceRoot, artifactId), JSON.stringify({
    ...exportMetadata,
    internal: {
      artifactPath,
      sourceRoot: selection.workspace.resolvedPath,
    },
  }, null, 2));

  return {
    ok: true,
    action: "archive-selection",
    export: exportMetadata,
  };
}
