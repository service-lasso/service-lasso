import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { extractZipSafely } from "../dist/runtime/files/safe-zip.js";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

export function extractionCommand(platform, archivePath, extractionRoot) {
  if (platform === "linux" || platform === "darwin") {
    return {
      command: "tar",
      args: ["-xf", archivePath, "-C", extractionRoot],
    };
  }
  throw new TypeError(`Unsupported qualification platform: ${platform}.`);
}

export async function extractPublishedPackageArchive(
  archivePath,
  extractionRoot,
  platform,
) {
  await mkdir(extractionRoot, { recursive: true });
  try {
    if (platform === "win32") {
      await extractZipSafely(archivePath, extractionRoot, archivePath, {
        rejectUnsafeEntries: true,
      });
    } else {
      const plan = extractionCommand(platform, archivePath, extractionRoot);
      await run(plan.command, plan.args);
    }
  } catch (cause) {
    const error = new Error(
      "Verified Core release archive extraction failed.",
      {
        cause,
      },
    );
    error.code = "core_archive_extraction_failed";
    throw error;
  }
}
