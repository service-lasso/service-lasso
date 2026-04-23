import path from "node:path";
import { access } from "node:fs/promises";
import type { FileHealthcheck, ServiceHealthResult } from "./types.js";

export async function checkFileHealth(
  healthcheck: FileHealthcheck,
  serviceRoot?: string,
): Promise<ServiceHealthResult> {
  const configuredFile = healthcheck.file.trim();
  const targetPath =
    serviceRoot && !path.isAbsolute(configuredFile) ? path.resolve(serviceRoot, configuredFile) : configuredFile;

  try {
    await access(targetPath);
    return {
      type: "file",
      healthy: true,
      detail: `File healthcheck found expected file: ${targetPath}`,
    };
  } catch {
    return {
      type: "file",
      healthy: false,
      detail: `File healthcheck did not find expected file: ${targetPath}`,
    };
  }
}
