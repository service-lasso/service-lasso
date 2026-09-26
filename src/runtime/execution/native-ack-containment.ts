// Caller must bind this to a verified native launcher and acknowledgement failure.
// Its outer process-control deadline remains authoritative for the whole race.
export async function observeNativeAcknowledgementContainment(options: {
  signal: AbortSignal;
  exit: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  terminate: (signal: AbortSignal) => Promise<unknown>;
  verifyStopped: () => Promise<void>;
}): Promise<void> {
  options.signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const termination = Promise.resolve().then(() => options.terminate(controller.signal));
  void termination.catch(() => undefined);
  const nativeCompletion = options.exit.then(({ exitCode, signal }) =>
    exitCode === 106 && signal === null
      ? "native" as const
      : new Promise<never>(() => undefined));
  try {
    const outcome = await Promise.race([
      termination.then(() => "terminated" as const), nativeCompletion,
    ]);
    if (outcome === "native") {
      abort();
      options.signal.throwIfAborted();
      await options.verifyStopped();
    }
  } finally {
    abort();
    options.signal.removeEventListener("abort", abort);
  }
}
