export type { RuntimeApp } from "../../dist/runtime/app.js";
export type {
  ApiServerOptions,
  RunningApiServer,
} from "../../dist/server/index.js";
export type {
  SecretLeakFinding,
  SecretLeakScanOptions,
  SecretLeakSentinel,
} from "../../dist/testing/secretLeakHarness.js";

export declare function startRuntimeApp(
  options?: import("../../dist/server/index.js").ApiServerOptions,
): Promise<import("../../dist/runtime/app.js").RuntimeApp>;

export declare const createRuntime: typeof startRuntimeApp;

export declare function startApiServer(
  options?: import("../../dist/server/index.js").ApiServerOptions,
): Promise<import("../../dist/server/index.js").RunningApiServer>;

export declare function scanForSecretMaterial(
  input: unknown,
  options?: import("../../dist/testing/secretLeakHarness.js").SecretLeakScanOptions,
): Promise<
  import("../../dist/testing/secretLeakHarness.js").SecretLeakFinding[]
>;

export declare function assertNoSecretMaterial(
  input: unknown,
  options?: import("../../dist/testing/secretLeakHarness.js").SecretLeakScanOptions,
): Promise<void>;

export declare function serviceLassoSecretLeakSentinels(): Promise<
  import("../../dist/testing/secretLeakHarness.js").SecretLeakSentinel[]
>;
