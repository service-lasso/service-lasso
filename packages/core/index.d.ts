export type { RuntimeApp } from "../../dist/runtime/app.js";
export type { ApiServerOptions, RunningApiServer } from "../../dist/server/index.js";

export declare function startRuntimeApp(
  options?: import("../../dist/server/index.js").ApiServerOptions,
): Promise<import("../../dist/runtime/app.js").RuntimeApp>;

export declare const createRuntime: typeof startRuntimeApp;

export declare function startApiServer(
  options?: import("../../dist/server/index.js").ApiServerOptions,
): Promise<import("../../dist/server/index.js").RunningApiServer>;
