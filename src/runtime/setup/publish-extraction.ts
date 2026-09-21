import { lstat, rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const retryDelays = [100, 200, 400, 800, 1000, 1600] as const;

async function destinationExists(destination: string): Promise<boolean> {
  try {
    await lstat(destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Publish only this transaction's staging tree; never delete a destination. */
export async function publishExtraction(
  source: string,
  destination: string,
  options: {
    platform?: NodeJS.Platform;
    rename?: typeof rename;
    exists?: typeof destinationExists;
    wait?: (milliseconds: number) => Promise<unknown>;
  } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const move = options.rename ?? rename;
  const exists = options.exists ?? destinationExists;
  const wait = options.wait ?? delay;
  let firstError: unknown;
  for (let attempt = 0; ; attempt += 1) {
    if (await exists(destination)) {
      if (firstError) throw firstError;
      throw Object.assign(new Error("Artifact publication destination already exists."), { code: "EEXIST" });
    }
    try {
      await move(source, destination);
      return;
    } catch (error) {
      firstError ??= error;
      const code = (error as NodeJS.ErrnoException).code;
      if (platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") || attempt >= retryDelays.length) {
        throw firstError;
      }
      await wait(retryDelays[attempt]!);
    }
  }
}
