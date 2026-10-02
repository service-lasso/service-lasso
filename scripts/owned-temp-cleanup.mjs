import { rm } from "node:fs/promises";

const filesystemCodes = new Set([
  "EBUSY", "ENOTEMPTY", "EPERM", "EACCES", "ENOENT", "ENOTDIR", "EISDIR",
  "EINVAL", "EIO", "EMFILE", "ENFILE", "EROFS", "ENAMETOOLONG", "ELOOP",
  "ENOSPC", "EDQUOT", "EBADF", "ENOSYS", "ENOMEM", "EXDEV",
]);
const retryableCodes = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
const failures = new WeakMap();

function observedFilesystemCode(error) {
  if (!error || typeof error !== "object") return "unknown";
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const code = descriptor && "value" in descriptor ? descriptor.value : undefined;
    return typeof code === "string" && filesystemCodes.has(code) ? code : "unknown";
  } catch {
    return "unknown";
  }
}

// Only this removal adapter can mint an observation. No caught exception is
// retained, and caller-supplied properties cannot forge the invocation count.
export function ownedTempCleanupObservation(error) {
  const observation = error && typeof error === "object" ? failures.get(error) : undefined;
  return observation ? { ...observation } : undefined;
}

export async function removeOwnedTempRoot(tempRoot, {
  remove = rm,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      await remove(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      const filesystemCode = observedFilesystemCode(error);
      if (!retryableCodes.has(filesystemCode) || attempt === 8) {
        const failure = new Error("Owned temporary root cleanup failed.");
        failures.set(failure, {
          operation: "remove_owned_temp_root",
          filesystemCode,
          attempts: attempt,
        });
        throw failure;
      }
      await wait(attempt * 100);
    }
  }
}
