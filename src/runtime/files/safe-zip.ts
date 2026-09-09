import path from "node:path";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";

/** Archive entry metadata exposed by {@link ZipArchive}. */
export interface ZipArchiveEntry {
  entryName: string;
  isDirectory: boolean;
  getData(): Buffer;
}

/**
 * Validates a ZIP entry name and returns normalized path segments.
 * Throws when the entry can escape the extraction root.
 */
export function assertSafeArchiveEntry(entryName: string, archiveLabel: string): string[] {
  const rawSegments = entryName.replaceAll("\\", "/").split("/");
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Unsafe archive entry "${entryName}" in ${archiveLabel}.`);
  }

  const normalized = path.posix.normalize(rawSegments.join("/"));
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe archive entry "${entryName}" in ${archiveLabel}.`);
  }

  return normalized.split("/").filter(Boolean);
}

/**
 * Returns true when {@link resolvedPath} stays inside {@link destinationRoot}.
 */
export function isPathContainedInRoot(destinationRoot: string, resolvedPath: string): boolean {
  const relativePath = path.relative(destinationRoot, resolvedPath);
  if (relativePath.length === 0) {
    return true;
  }
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

/**
 * Resolves an archive entry under a destination root and rejects escapes.
 */
export function resolveContainedArchiveTarget(destinationRoot: string, segments: string[]): string {
  const targetPath = path.resolve(destinationRoot, ...segments);
  if (!isPathContainedInRoot(destinationRoot, targetPath)) {
    throw new Error(`Unsafe archive entry "${segments.join("/")}" escapes ${destinationRoot}.`);
  }
  return targetPath;
}

/** Options for {@link extractZipSafely}. */
export interface ExtractZipSafelyOptions {
  /** When true, reject archives that contain unsafe entry names instead of skipping them. */
  rejectUnsafeEntries?: boolean;
}

/**
 * In-memory ZIP archive backed by fflate for read and write operations.
 */
export class ZipArchive {
  private readonly entries: Map<string, Buffer>;
  private readonly directoryEntries: Set<string>;

  /**
   * Creates an empty archive or loads one from a filesystem path or buffer.
   */
  constructor(source?: string | Buffer) {
    this.entries = new Map();
    this.directoryEntries = new Set();

    if (source === undefined) {
      return;
    }

    const buffer = typeof source === "string" ? readFileSync(source) : source;
    this.loadFromBuffer(buffer);
  }

  /**
   * Returns every archive entry in stable name order.
   */
  getEntries(): ZipArchiveEntry[] {
    const names = new Set<string>([...this.entries.keys(), ...this.directoryEntries]);
    return [...names]
      .sort((left, right) => left.localeCompare(right))
      .map((entryName) => this.toArchiveEntry(entryName, names));
  }

  /**
   * Returns one archive entry by exact name, or null when absent.
   */
  getEntry(entryName: string): ZipArchiveEntry | null {
    const normalized = normalizeZipEntryName(entryName);
    if (!this.entries.has(normalized) && !this.directoryEntries.has(normalized)) {
      return null;
    }

    const names = new Set<string>([...this.entries.keys(), ...this.directoryEntries]);
    return this.toArchiveEntry(normalized, names);
  }

  /**
   * Adds or replaces one file entry using forward-slash archive paths.
   */
  addFile(entryPath: string, data: Buffer): void {
    const normalized = normalizeZipEntryName(entryPath);
    if (normalized.length === 0) {
      throw new Error("ZIP entry path must not be empty.");
    }

    this.entries.set(normalized, Buffer.from(data));
    this.trackParentDirectories(normalized);
  }

  /**
   * Serializes the archive to an in-memory buffer.
   */
  toBuffer(): Buffer {
    const payload: Record<string, Uint8Array> = {};
    for (const [entryName, data] of this.entries.entries()) {
      payload[entryName] = new Uint8Array(data);
    }
    for (const directoryName of this.directoryEntries) {
      if (!this.entries.has(directoryName)) {
        payload[`${directoryName}/`] = new Uint8Array();
      }
    }
    return Buffer.from(zipSync(payload));
  }

  /**
   * Writes the archive to disk, replacing any existing file.
   */
  async writeZip(destinationPath: string): Promise<void> {
    await writeFile(destinationPath, this.toBuffer());
  }

  private loadFromBuffer(buffer: Buffer): void {
    const unzipped = unzipSync(new Uint8Array(buffer));
    for (const [entryName, data] of Object.entries(unzipped)) {
      const normalized = normalizeZipEntryName(entryName);
      if (normalized.length === 0) {
        continue;
      }

      if (entryName.endsWith("/")) {
        this.directoryEntries.add(normalized);
        continue;
      }

      this.entries.set(normalized, Buffer.from(data));
      this.trackParentDirectories(normalized);
    }
  }

  private trackParentDirectories(entryName: string): void {
    const segments = entryName.split("/").filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      this.directoryEntries.add(segments.slice(0, index).join("/"));
    }
  }

  private toArchiveEntry(entryName: string, allNames: Set<string>): ZipArchiveEntry {
    const isDirectory =
      this.directoryEntries.has(entryName) ||
      entryName.endsWith("/") ||
      [...allNames].some((candidate) => candidate !== entryName && candidate.startsWith(`${entryName}/`));

    return {
      entryName,
      isDirectory,
      getData: (): Buffer => this.entries.get(entryName) ?? Buffer.alloc(0),
    };
  }
}

/**
 * Recursively adds one local directory tree to an archive under a prefix.
 */
export async function addLocalFolderToArchive(
  archive: ZipArchive,
  sourceDirectory: string,
  destinationPrefix: string,
): Promise<void> {
  const normalizedPrefix = normalizeZipEntryName(destinationPrefix);

  async function visit(currentSource: string, currentPrefix: string): Promise<void> {
    const children = await readdirWithTypes(currentSource);
    for (const child of children) {
      const childSource = path.join(currentSource, child.name);
      const childPrefix = currentPrefix.length > 0 ? `${currentPrefix}/${child.name}` : child.name;

      if (child.kind === "directory") {
        await visit(childSource, childPrefix);
        continue;
      }

      if (child.kind === "file") {
        archive.addFile(childPrefix, await readFile(childSource));
        continue;
      }

      throw new Error(`Unsupported archive source entry: ${childSource}`);
    }
  }

  await visit(sourceDirectory, normalizedPrefix);
}

/**
 * Adds one local file under a destination directory prefix inside the archive.
 */
export async function addLocalFileToArchive(
  archive: ZipArchive,
  sourcePath: string,
  destinationDirectory: string,
): Promise<void> {
  const entryPath = `${normalizeZipEntryName(destinationDirectory)}/${path.basename(sourcePath)}`;
  archive.addFile(entryPath, await readFile(sourcePath));
}

/**
 * Extracts a ZIP archive without following destination symlinks or writing outside the root.
 * Unsafe entry names are skipped fail-closed rather than written unless
 * {@link ExtractZipSafelyOptions.rejectUnsafeEntries} is enabled.
 */
export async function extractZipSafely(
  source: string | Buffer,
  destinationPath: string,
  archiveLabel?: string,
  options?: ExtractZipSafelyOptions,
): Promise<void> {
  const label = archiveLabel ?? (typeof source === "string" ? source : "<buffer>");
  const rejectUnsafeEntries = options?.rejectUnsafeEntries === true;
  const buffer = typeof source === "string" ? readFileSync(source) : source;
  const archive = new ZipArchive(buffer);

  await rm(destinationPath, { recursive: true, force: true });
  await mkdir(destinationPath, { recursive: true });

  const destinationRoot = path.resolve(destinationPath);
  const destinationStat = await lstat(destinationRoot);
  if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
    throw new Error("Archive extraction destination must be a real directory.");
  }

  for (const entry of archive.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }

    let segments: string[];
    try {
      segments = assertSafeArchiveEntry(entry.entryName, label);
    } catch (error) {
      if (rejectUnsafeEntries) {
        throw error;
      }
      continue;
    }

    let targetPath: string;
    try {
      targetPath = resolveContainedArchiveTarget(destinationRoot, segments);
    } catch (error) {
      if (rejectUnsafeEntries) {
        throw error;
      }
      continue;
    }

    try {
      await assertWritableContainedPath(destinationRoot, targetPath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await assertWritableContainedPath(destinationRoot, path.dirname(targetPath));
      await writeFile(targetPath, entry.getData());
    } catch (error) {
      if (error instanceof Error && error.message.includes("Archive extraction blocked")) {
        if (rejectUnsafeEntries) {
          throw error;
        }
        continue;
      }
      throw error;
    }
  }
}

async function assertWritableContainedPath(destinationRoot: string, targetPath: string): Promise<void> {
  if (!isPathContainedInRoot(destinationRoot, targetPath)) {
    throw new Error(`Archive extraction blocked: ${targetPath} escapes ${destinationRoot}.`);
  }

  const relativePath = path.relative(destinationRoot, targetPath);
  let current = destinationRoot;
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    if (stat.isSymbolicLink()) {
      throw new Error(`Archive extraction blocked by symlink at ${current}.`);
    }
  }
}

async function readdirWithTypes(sourceDirectory: string): Promise<Array<{ name: string; kind: "file" | "directory" }>> {
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  return entries
    .map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? "directory" as const : entry.isFile() ? "file" as const : "unsupported" as const,
    }))
    .filter((entry): entry is { name: string; kind: "file" | "directory" } => entry.kind !== "unsupported")
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeZipEntryName(entryName: string): string {
  return entryName.replaceAll("\\", "/").replace(/\/+$/u, "");
}
