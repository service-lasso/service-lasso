import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm, statfs } from "node:fs/promises";
import type { DiscoveredService } from "../../contracts/service.js";

const TMPFS_MAGIC = 0x01021994;

export function hasEphemeralSecretFiles(service: DiscoveredService): boolean {
  return [...(service.manifest.broker?.files ?? []), ...(service.manifest.broker?.templates ?? [])].length > 0;
}

function secretsRoot(): string {
  const root = process.env.SERVICE_LASSO_SECRETS_ROOT ?? "/run/service-lasso/secrets";
  if (!root || !path.isAbsolute(root)) throw new Error("Core secrets root must be an absolute path.");
  return path.normalize(root);
}

export function serviceSecretsDirectory(service: DiscoveredService): string {
  const identity = createHash("sha256")
    .update(JSON.stringify([service.manifest.id, path.resolve(service.serviceRoot)]))
    .digest("hex");
  return path.join(secretsRoot(), identity);
}

async function requirePrivateTmpfsDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 ||
      await realpath(directory) !== directory || (await statfs(directory)).type !== TMPFS_MAGIC) {
    throw new Error("Core secret files require an owned private tmpfs directory without redirects.");
  }
}

/** No persistent fallback, symlink following, or transaction preimage of plaintext. */
export async function writeEphemeralSecretFile(
  service: DiscoveredService,
  relativePath: string,
  content: string,
): Promise<void> {
  if (process.platform !== "linux") throw new Error("Ephemeral secret files require Linux tmpfs.");
  const root = secretsRoot();
  const fromService = path.relative(path.resolve(service.serviceRoot), root);
  if (!fromService || (!fromService.startsWith("..") && !path.isAbsolute(fromService))) {
    throw new Error("Core secrets root must be outside the app service directory.");
  }
  const directory = serviceSecretsDirectory(service);
  const target = path.resolve(directory, relativePath);
  const relative = path.relative(directory, target);
  if (!relativePath || path.isAbsolute(relativePath) || !relative ||
      relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Ephemeral secret file path must remain relative to its Core directory.");
  }
  // Deployment supplies this mount; never create the configured root on disk.
  await requirePrivateTmpfsDirectory(root);
  let parent = root;
  for (const segment of path.relative(root, path.dirname(target)).split(path.sep)) {
    parent = path.join(parent, segment);
    await mkdir(parent, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    await requirePrivateTmpfsDirectory(parent);
  }
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid?.()) {
      throw new Error("Ephemeral secret target must be an owned unaliased regular file.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = path.join(parent, `.secret-${randomUUID()}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await requirePrivateTmpfsDirectory(parent);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
