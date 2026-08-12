async function loadRuntimeApp() {
  return import("../../dist/runtime/app.js");
}

async function loadApiServer() {
  return import("../../dist/server/index.js");
}

async function loadSecretLeakHarness() {
  return import("../../dist/testing/secretLeakHarness.js");
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

export async function scanForSecretMaterial(input, options = {}) {
  const harness = await loadSecretLeakHarness();
  return harness.scanForSecretMaterial(input, options);
}

export async function assertNoSecretMaterial(input, options = {}) {
  const harness = await loadSecretLeakHarness();
  return harness.assertNoSecretMaterial(input, options);
}

export async function serviceLassoSecretLeakSentinels() {
  const harness = await loadSecretLeakHarness();
  return harness.serviceLassoSecretLeakSentinels;
}
