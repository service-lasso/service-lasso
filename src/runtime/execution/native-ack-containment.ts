// Caller must bind this to a verified native launcher and acknowledgement failure.
// Its outer process-control deadline remains authoritative for the whole race.
export async function observeNativeAcknowledgementContainment(options: {
  signal: AbortSignal;
  nativeObservationMs?: number;
  exit: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  terminate: (signal: AbortSignal) => Promise<unknown>;
  verifyStopped: () => Promise<void>;
}): Promise<void> {
  options.signal.throwIfAborted();
  if ((options.nativeObservationMs ?? 0) > 0) {
    let timer: NodeJS.Timeout | undefined;
    let cancelObservation: (() => void) | undefined;
    try {
      const elapsed = new Promise<null>((resolve, reject) => {
        timer = setTimeout(() => resolve(null), options.nativeObservationMs);
        cancelObservation = () => reject(options.signal.reason);
        options.signal.addEventListener("abort", cancelObservation, { once: true });
      });
      const observed = await Promise.race([options.exit, elapsed]);
      options.signal.throwIfAborted();
      if (observed?.exitCode === 106 && observed.signal === null) {
        await options.verifyStopped();
        return;
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (cancelObservation) options.signal.removeEventListener("abort", cancelObservation);
    }
  }
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
