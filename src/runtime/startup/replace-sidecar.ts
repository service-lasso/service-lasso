import { rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const retryDelays = [20, 40, 80, 160, 320] as const;

/** Retry atomic replacement only; never remove the previous recovery record. */
export async function replaceStartupSidecar(
  source: string,
  destination: string,
  validate: () => Promise<void>,
  dependencies: {
    platform?: NodeJS.Platform;
    rename?: typeof rename;
    wait?: (milliseconds: number) => Promise<unknown>;
  } = {},
): Promise<void> {
  const platform = dependencies.platform ?? process.platform;
  const move = dependencies.rename ?? rename;
  const wait = dependencies.wait ?? delay;
  let firstError: unknown;
  for (let attempt = 0; ; attempt += 1) {
    await validate();
    try {
      await move(source, destination);
      return;
    } catch (error) {
      firstError ??= error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") || attempt >= retryDelays.length) {
        throw firstError;
      }
      await wait(retryDelays[attempt]!);
    }
  }
}
