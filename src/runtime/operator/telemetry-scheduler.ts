import {
  buildRuntimeTelemetryPreview,
  isTelemetryContinuousExportEnabled,
  readTelemetryContinuousExportIntervalMs,
  sendRuntimeTelemetryExport,
  type RuntimeTelemetryPreview,
  type TelemetryContinuousExportRuntimeState,
  type TelemetryExportActionResult,
} from "./telemetry.js";

export interface RuntimeTelemetryExportScheduler {
  start: () => void;
  stop: () => Promise<void>;
  getStatus: () => TelemetryContinuousExportRuntimeState;
}

export interface RuntimeTelemetryExportSchedulerOptions {
  collectTelemetry: (status: TelemetryContinuousExportRuntimeState) => Promise<RuntimeTelemetryPreview>;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  initialDelayMs?: number;
}

export function createRuntimeTelemetryExportScheduler(
  options: RuntimeTelemetryExportSchedulerOptions,
): RuntimeTelemetryExportScheduler {
  const env = options.env ?? process.env;
  const intervalMs = readTelemetryContinuousExportIntervalMs(env);
  let running = false;
  let inFlight = false;
  let timer: NodeJS.Timeout | null = null;
  let lastAttemptAt: string | null = null;
  let lastResult: TelemetryExportActionResult | null = null;

  const status = (): TelemetryContinuousExportRuntimeState => ({
    running,
    intervalMs,
    inFlight,
    lastAttemptAt,
    lastResult,
  });

  async function runOnce(): Promise<void> {
    if (!running || inFlight) {
      return;
    }

    inFlight = true;
    lastAttemptAt = new Date().toISOString();

    try {
      const telemetry = await options.collectTelemetry(status());
      lastResult = await sendRuntimeTelemetryExport(
        buildRuntimeTelemetryPreview(
          telemetry.services,
          telemetry.apiRequests,
          {
            capacity: telemetry.apiRequestBuffer.capacity,
            droppedCount: telemetry.apiRequestBuffer.droppedCount,
          },
          env,
          status(),
        ),
        env,
        options.fetchImpl,
      );
    } catch (error) {
      lastResult = {
        mode: "export",
        status: "failed",
        protocol: "otlp-http",
        contentType: "application/json",
        signalCount: 0,
        serviceCount: 0,
        endpointConfigured: typeof env.OTEL_EXPORTER_OTLP_ENDPOINT === "string" && env.OTEL_EXPORTER_OTLP_ENDPOINT.trim().length > 0,
        endpointValueReturned: false,
        headersConfigured: typeof env.OTEL_EXPORTER_OTLP_HEADERS === "string" && env.OTEL_EXPORTER_OTLP_HEADERS.trim().length > 0,
        headersValueReturned: false,
        bodyValueReturned: false,
        exporterStatusCode: null,
        reason: `Continuous OTLP export failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      inFlight = false;
    }
  }

  function scheduleNext(delayMs: number): void {
    timer = setTimeout(() => {
      void runOnce().finally(() => {
        if (running) {
          scheduleNext(intervalMs);
        }
      });
    }, delayMs);
    timer.unref?.();
  }

  return {
    start: () => {
      if (running || !isTelemetryContinuousExportEnabled(env)) {
        return;
      }
      running = true;
      scheduleNext(options.initialDelayMs ?? 0);
    },
    stop: async () => {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const stopStartedAt = Date.now();
      while (inFlight && Date.now() - stopStartedAt < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    getStatus: status,
  };
}
