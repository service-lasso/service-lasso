import { rm } from "node:fs/promises";
import { types } from "node:util";

const filesystemCodes = new Set([
  "EBUSY", "ENOTEMPTY", "EPERM", "EACCES", "ENOENT", "ENOTDIR", "EISDIR",
  "EINVAL", "EIO", "EMFILE", "ENFILE", "EROFS", "ENAMETOOLONG", "ELOOP",
  "ENOSPC", "EDQUOT", "EBADF", "ENOSYS", "ENOMEM", "EXDEV",
]);
const retryableCodes = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
const failures = new WeakMap();
const syscalls = new Set(["rmdir", "unlink", "scandir", "lstat", "stat", "open", "rm"]);

function ownNativeData(error, key) {
  if (!error || typeof error !== "object" || types.isProxy(error)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function observedFilesystemCode(error) {
  const code = ownNativeData(error, "code");
  return typeof code === "string" && code.length <= 16 && filesystemCodes.has(code) ? code : "unknown";
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
  report = value => process.stderr.write(value),
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
        // No raw exception retained; this is independent of the original strict
        // cleanup projection. A syscall category is not a leaf/owner witness.
        const syscall = ownNativeData(error, "syscall");
        try { report(`[native-boundary-failure-observation] ${JSON.stringify({
          schema: "service-lasso.native-boundary-failure-observation.v1",
          boundary: "owned_temp_cleanup", observationStatus: "captured",
          targetRole: "owned_temp_root", filesystemCode, attempts: attempt,
          syscall: typeof syscall === "string" && syscall.length <= 16 && syscalls.has(syscall) ? syscall : "unknown",
          privateIdentity: "unavailable", lockOwner: "unavailable", descendants: "unavailable",
        })}\n`); } catch { /* Preserve the primary cleanup failure. */ }
        throw failure;
      }
      await wait(attempt * 100);
    }
  }
}
