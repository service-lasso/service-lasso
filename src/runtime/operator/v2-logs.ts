import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredService } from "../../contracts/service.js";
import { ApiError } from "../../server/errors.js";
import type { OperatorV2Page } from "../../server/operator-v2.js";
import { redactDiagnosticsValue } from "../diagnostics/bundle.js";
import { getServiceRuntimeLogPaths } from "./logs.js";

const MAX_WINDOW_BYTES = 1024 * 1024;
const MAX_ROWS = 50;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

interface OperatorLogRow {
  rowId: string;
  serviceId: string;
  stream: "stdout" | "stderr";
  runId: string;
  time: string;
  text: string;
  truncated: boolean;
}

function invalid(): never {
  throw new ApiError("invalid_request", 400, "Invalid operator log selection.");
}

function safeMessage(message: string, serviceRoot: string, workspaceRoot?: string) {
  let redacted = String(redactDiagnosticsValue(message))
    .replaceAll(serviceRoot, "[SERVICE_ROOT]")
    .replaceAll(serviceRoot.split(path.sep).join("/"), "[SERVICE_ROOT]")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\p{Cc}/gu, "")
    .replace(/((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
  if (workspaceRoot) redacted = redacted.replaceAll(workspaceRoot, "[WORKSPACE_ROOT]")
    .replaceAll(workspaceRoot.split(path.sep).join("/"), "[WORKSPACE_ROOT]");
  const points: string[] = [];
  let bytes = 0;
  for (const point of redacted) {
    const size = Buffer.byteLength(point, "utf8");
    if (bytes + size > 4096) break;
    points.push(point);
    bytes += size;
  }
  const text = points.join("");
  return { text, truncated: text.length < redacted.length };
}

export async function readOperatorV2Logs(
  service: DiscoveredService,
  runId: string | null,
  generationId: string,
  query: URLSearchParams,
  workspaceRoot?: string,
): Promise<OperatorV2Page<OperatorLogRow>> {
  const keys = [...query.keys()];
  if (keys.some(key => !["stream", "search", "cursor", "limit"].includes(key)) ||
      new Set(keys).size !== keys.length) invalid();
  const stream = query.get("stream") ?? "combined";
  if (!["combined", "stdout", "stderr", "declared"].includes(stream)) invalid();
  if (stream === "declared") {
    throw new ApiError("unsupported_capability", 409, "Declared log sources are not supported by this view.");
  }
  const search = query.get("search") ?? "";
  if (Buffer.byteLength(search, "utf8") > 256 || /[\x00-\x1f\x7f]/.test(search)) invalid();
  const limitText = query.get("limit") ?? "25";
  if (!/^[1-9][0-9]?$/.test(limitText) || Number(limitText) > MAX_ROWS) invalid();
  const limit = Number(limitText);
  const selectedRun = runId ?? "current";
  const runIdentity = "log-run-" + digest(generationId + ":" + selectedRun).slice(0, 32);
  const location = getServiceRuntimeLogPaths(service.serviceRoot, selectedRun).logPath;
  let bytes = Buffer.alloc(0);
  let fileSize = 0;
  let sourceIdentity = "absent";
  let offset = 0;
  try {
    const root = await realpath(service.serviceRoot);
    const target = await realpath(location);
    if (!target.startsWith(root + path.sep) || target !== path.resolve(location)) {
      throw new ApiError("source_unavailable", 503, "The current log source is unavailable.");
    }
    const handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new ApiError("source_unavailable", 503, "The current log source is unavailable.");
      fileSize = info.size;
      sourceIdentity = `${info.dev}:${info.ino}`;
      offset = Math.max(0, info.size - MAX_WINDOW_BYTES);
      bytes = Buffer.alloc(info.size - offset);
      const read = await handle.read(bytes, 0, bytes.length, offset);
      bytes = bytes.subarray(0, read.bytesRead);
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof ApiError) throw error;
      throw new ApiError("source_unavailable", 503, "The current log source is unavailable.");
    }
  }
  const revision = "log-source-" + digest(JSON.stringify({ serviceId: service.manifest.id,
    generationId, selectedRun, sourceIdentity, fileSize, bytes: digest(bytes), stream, search })).slice(0, 40);
  let end: number | null = null;
  let expiresAt = Date.now() + 60_000;
  const cursor = query.get("cursor");
  if (cursor) {
    if (cursor.length > 128 || !/^[A-Za-z0-9_-]+$/.test(cursor)) invalid();
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Array.isArray(decoded) || decoded.length !== 3 ||
          !Number.isSafeInteger(decoded[1]) || decoded[1] < 0 ||
          !Number.isSafeInteger(decoded[2]) || decoded[2] > Date.now() + 60_000) invalid();
      if (decoded[0] !== revision || decoded[2] <= Date.now()) {
        throw new ApiError("snapshot_expired", 410, "Log output changed. Refresh the log view.");
      }
      end = decoded[1];
      expiresAt = decoded[2];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      invalid();
    }
  }
  let partial = offset > 0;
  let skipped = false;
  let eventCount = 0;
  const rows: OperatorLogRow[] = [];
  let text = bytes.toString("utf8");
  if (offset > 0) {
    const firstEnd = text.indexOf("\n");
    text = firstEnd < 0 ? "" : text.slice(firstEnd + 1);
  }
  // Only complete records have been committed by the writer. A partial last write is not an event.
  const completeEnd = text.lastIndexOf("\n");
  if (completeEnd < text.length - 1) partial = true;
  text = completeEnd < 0 ? "" : text.slice(0, completeEnd);
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    let record: { capturedAt?: unknown; level?: unknown; message?: unknown };
    try { record = JSON.parse(line); } catch { skipped = true; continue; }
    if (!record || typeof record.capturedAt !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.capturedAt) ||
        !Number.isFinite(Date.parse(record.capturedAt)) || new Date(record.capturedAt).toISOString() !== record.capturedAt ||
        (record.level !== "stdout" && record.level !== "stderr") || typeof record.message !== "string") {
      skipped = true; continue;
    }
    eventCount++;
    if (stream !== "combined" && record.level !== stream) continue;
    const message = safeMessage(record.message, service.serviceRoot, workspaceRoot);
    if (!message.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())) continue;
    rows.push({ rowId: "log-row-" + digest(runIdentity + ":" + offset + ":" + index + ":" + line).slice(0, 40),
      serviceId: service.manifest.id, stream: record.level, runId: runIdentity,
      time: record.capturedAt, text: message.text, truncated: message.truncated });
  }
  if (!eventCount && skipped) {
    throw new ApiError("source_unavailable", 503, "These logs have no captured event times. New runtime output will appear here.");
  }
  if (end !== null && end > rows.length) invalid();
  const before = end ?? rows.length;
  let start = before;
  let wireBytes = 0;
  // Leave room for the envelope, page metadata and continuation within the advertised 256 KiB response.
  while (start > Math.max(0, before - limit)) {
    const rowBytes = Buffer.byteLength(JSON.stringify(rows[start - 1]), "utf8") + 1;
    if (wireBytes + rowBytes > 240_000) break;
    wireBytes += rowBytes;
    start--;
  }
  return { snapshotId: revision, sourceRevision: revision, rows: rows.slice(start, before),
    nextCursor: start > 0 ? Buffer.from(JSON.stringify([revision, start, expiresAt])).toString("base64url") : null,
    expiresAt: new Date(expiresAt).toISOString(), truncated: partial || skipped };
}
