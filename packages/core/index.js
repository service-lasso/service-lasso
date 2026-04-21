async function loadRuntimeApp() {
  return import("../../dist/runtime/app.js");
}

async function loadApiServer() {
  return import("../../dist/server/index.js");
}

export async function startRuntimeApp(options = {}) {
  const runtimeModule = await loadRuntimeApp();
  return runtimeModule.startRuntimeApp(options);
}

export const createRuntime = startRuntimeApp;

export async function startApiServer(options = {}) {
  const serverModule = await loadApiServer();
  return serverModule.startApiServer(options);
}
