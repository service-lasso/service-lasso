import { spawn } from "node:child_process";

const PROCESS_CONTROL_HELPER_EXIT_RESERVE_MS = 100;

export class ProcessControlDeadlineError extends Error {
  readonly code = "PROCESS_CONTROL_DEADLINE_EXCEEDED";

  constructor() {
    super("Process control did not converge before its deadline.");
    this.name = "ProcessControlDeadlineError";
  }
}

export interface ProcessControlDeadlineOptions {
  deadlineMs?: number;
  signal?: AbortSignal;
}

export interface ProcessControlCommandResult {
  exitCode: number | null;
  stdout: string;
}

export type ProcessControlCommandRunner = (
  command: string,
  args: string[],
  options: { captureOutput: boolean; signal: AbortSignal },
) => Promise<ProcessControlCommandResult>;

async function runSpawnedProcessControlCommand(
  command: string,
  args: string[],
  options: { captureOutput: boolean; signal: AbortSignal },
): Promise<ProcessControlCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.captureOutput ? ["ignore", "pipe", "ignore"] : "ignore",
      windowsHide: true,
    });
    let output = "";
    let abortRequested = false;
    const abort = () => {
      abortRequested = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // The final deadline remains fail closed if the exact helper cannot be
        // observed closing after the kill request.
      }
    };
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.captureOutput && child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
      });
    }
    child.once("close", (exitCode) => {
      options.signal.removeEventListener("abort", abort);
      if (abortRequested) {
        reject(new ProcessControlDeadlineError());
        return;
      }
      resolve({ exitCode, stdout: output });
    });
    child.once("error", (error) => {
      if (!abortRequested) {
        options.signal.removeEventListener("abort", abort);
        reject(error);
      }
    });
    if (options.signal.aborted) abort();
  });
}

export async function runProcessControlCommand(
  command: string,
  args: string[],
  options: ProcessControlDeadlineOptions & {
    captureOutput: boolean;
    runner?: ProcessControlCommandRunner;
  },
): Promise<ProcessControlCommandResult> {
  if (options.signal?.aborted) {
    throw new ProcessControlDeadlineError();
  }
  const runner = options.runner ?? runSpawnedProcessControlCommand;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const remainingMs = options.deadlineMs === undefined
    ? null
    : remainingProcessControlMs(options.deadlineMs);
  if (remainingMs !== null && remainingMs <= 0) {
    options.signal?.removeEventListener("abort", abort);
    throw new ProcessControlDeadlineError();
  }
  const exitReserveMs = remainingMs === null
    ? 0
    : Math.min(PROCESS_CONTROL_HELPER_EXIT_RESERVE_MS, Math.max(1, Math.floor(remainingMs / 4)));
  let abortTimer: NodeJS.Timeout | undefined;
  let deadlineTimer: NodeJS.Timeout | undefined;
  if (remainingMs !== null) {
    abortTimer = setTimeout(abort, Math.max(1, remainingMs - exitReserveMs));
  }
  const pending = Promise.resolve().then(() => runner(command, args, {
    captureOutput: options.captureOutput,
    signal: controller.signal,
  }));
  void pending.catch(() => undefined);
  const deadline = remainingMs === null
    ? new Promise<never>(() => undefined)
    : new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          abort();
          reject(new ProcessControlDeadlineError());
        }, Math.max(1, remainingMs));
      });
  let rejectOuterAbort: ((error: ProcessControlDeadlineError) => void) | null = null;
  const outerAbort = new Promise<never>((_resolve, reject) => {
    rejectOuterAbort = reject;
  });
  const rejectOnOuterAbort = () => rejectOuterAbort?.(new ProcessControlDeadlineError());
  options.signal?.addEventListener("abort", rejectOnOuterAbort, { once: true });

  try {
    const result = await Promise.race([pending, deadline, outerAbort]);
    if (controller.signal.aborted) throw new ProcessControlDeadlineError();
    return result;
  } catch (error) {
    if (
      controller.signal.aborted ||
      options.signal?.aborted ||
      (options.deadlineMs !== undefined && remainingProcessControlMs(options.deadlineMs) <= 0)
    ) {
      throw new ProcessControlDeadlineError();
    }
    throw error;
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    options.signal?.removeEventListener("abort", abort);
    options.signal?.removeEventListener("abort", rejectOnOuterAbort);
  }
}

export function processControlDeadline(timeoutMs: number, outerDeadlineMs?: number): number {
  const localDeadline = Date.now() + Math.max(0, timeoutMs);
  return Number.isFinite(outerDeadlineMs)
    ? Math.min(localDeadline, Number(outerDeadlineMs))
    : localDeadline;
}

export function remainingProcessControlMs(deadlineMs: number): number {
  return Math.max(0, deadlineMs - Date.now());
}

export function isProcessControlDeadlineError(error: unknown): error is ProcessControlDeadlineError {
  return error instanceof ProcessControlDeadlineError || (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "PROCESS_CONTROL_DEADLINE_EXCEEDED"
  );
}

export async function withProcessControlDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: ProcessControlDeadlineOptions,
): Promise<T> {
  const deadlineMs = options.deadlineMs;
  if (deadlineMs !== undefined && remainingProcessControlMs(deadlineMs) <= 0) {
    throw new ProcessControlDeadlineError();
  }
  if (options.signal?.aborted) {
    throw new ProcessControlDeadlineError();
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  if (deadlineMs !== undefined) {
    timer = setTimeout(abort, Math.max(1, remainingProcessControlMs(deadlineMs)));
  }

  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(new ProcessControlDeadlineError()), { once: true });
  });
  const pending = Promise.resolve().then(() => operation(controller.signal));
  void pending.catch(() => undefined);

  try {
    return await Promise.race([pending, aborted]);
  } catch (error) {
    if (
      controller.signal.aborted ||
      options.signal?.aborted ||
      (deadlineMs !== undefined && remainingProcessControlMs(deadlineMs) <= 0)
    ) {
      throw new ProcessControlDeadlineError();
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
